//! The binary `.mesh` format: `@@b@`, then objects and properties. An object is a run of `[`,
//! as many as its depth, then its name and a NUL; a property is `!`, the name's length in a
//! byte, the name, a type byte (`i`, `f` or `s`) and a little-endian `u32` count of values,
//! each four bytes, or for `s` a `u32` length and that many bytes ending in NUL. Positions are
//! Y up.

/// One `.mesh` file: its shapes and the locators models attach to.
#[derive(Debug, Default)]
pub(super) struct MeshFile {
    pub(super) shapes: Vec<Shape>,
    pub(super) locators: Vec<Locator>,
}

#[derive(Debug, Default)]
pub(super) struct Shape {
    pub(super) name: String,
    pub(super) meshes: Vec<Mesh>,
    pub(super) joints: Vec<Joint>,
}

#[derive(Debug, Default)]
pub(super) struct Mesh {
    pub(super) positions: Vec<[f32; 3]>,
    pub(super) normals: Vec<[f32; 3]>,
    /// Tangent and the bitangent's sign, per vertex.
    pub(super) tangents: Vec<[f32; 4]>,
    pub(super) uvs: Vec<[f32; 2]>,
    pub(super) triangles: Vec<[u32; 3]>,
    pub(super) material: Material,
}

/// The texture files and shader a mesh's own material names.
#[derive(Debug, Default, Clone)]
pub(super) struct Material {
    pub(super) shader: String,
    pub(super) diffuse: String,
    pub(super) normal: String,
    pub(super) specular: String,
}

#[derive(Debug)]
pub(super) struct Joint {
    pub(super) name: String,
    /// The inverse of the joint's bind pose: three columns of a 3×3 matrix, then the
    /// translation.
    pub(super) inverse_bind: [f32; 12],
}

#[derive(Debug)]
pub(super) struct Locator {
    pub(super) name: String,
    pub(super) position: [f32; 3],
    /// A quaternion, `x y z w`.
    pub(super) rotation: [f32; 4],
    /// The joint it moves with, when it has one.
    pub(super) parent: Option<String>,
}

#[derive(Debug, Clone)]
enum Value {
    Ints(Vec<i32>),
    Floats(Vec<f32>),
    Strings(Vec<String>),
}

#[derive(Debug, Default)]
struct Node {
    name: String,
    props: Vec<(String, Value)>,
    children: Vec<usize>,
}

struct Tree {
    nodes: Vec<Node>,
}

pub(super) fn read(bytes: &[u8]) -> Result<MeshFile, String> {
    let tree = Tree::parse(bytes)?;
    let mut file = MeshFile::default();
    if let Some(object) = tree.child(0, "object") {
        for &shape in &tree.nodes[object].children {
            file.shapes.push(tree.shape(shape));
        }
    }
    if let Some(locators) = tree.child(0, "locator") {
        for &locator in &tree.nodes[locators].children {
            let rotation = tree.floats(locator, "q");
            file.locators.push(Locator {
                name: tree.nodes[locator].name.clone(),
                position: first3(tree.floats(locator, "p")),
                rotation: match rotation[..] {
                    [x, y, z, w, ..] => [x, y, z, w],
                    _ => [0.0, 0.0, 0.0, 1.0],
                },
                parent: tree.string(locator, "pa"),
            });
        }
    }
    Ok(file)
}

fn first3(v: &[f32]) -> [f32; 3] {
    match v {
        [x, y, z, ..] => [*x, *y, *z],
        _ => [0.0; 3],
    }
}

impl Tree {
    fn parse(b: &[u8]) -> Result<Tree, String> {
        if b.get(..4) != Some(b"@@b@") {
            return Err("not a binary mesh: no @@b@ header".into());
        }
        let mut nodes = vec![Node::default()];
        let mut stack = vec![0];
        let mut reader = Reader { b, at: 4 };
        while let Some(&byte) = b.get(reader.at) {
            match byte {
                b'[' => {
                    let mut depth = 0;
                    while b.get(reader.at) == Some(&b'[') {
                        depth += 1;
                        reader.at += 1;
                    }
                    let name = reader.c_string()?;
                    stack.truncate(depth);
                    let parent = *stack.last().ok_or("an object deeper than its parent")?;
                    let id = nodes.len();
                    nodes.push(Node {
                        name,
                        ..Node::default()
                    });
                    nodes[parent].children.push(id);
                    stack.push(id);
                }
                b'!' => {
                    reader.at += 1;
                    let (name, value) = reader.property()?;
                    let current = *stack.last().ok_or("a property outside any object")?;
                    nodes[current].props.push((name, value));
                }
                other => return Err(format!("unexpected byte {other:#x} at {}", reader.at)),
            }
        }
        Ok(Tree { nodes })
    }

    fn shape(&self, id: usize) -> Shape {
        let mut shape = Shape {
            name: self.nodes[id].name.clone(),
            ..Shape::default()
        };
        for mesh in self.children_named(id, "mesh") {
            let material = self.child(mesh, "material");
            let text = |key: &str| {
                material
                    .and_then(|m| self.string(m, key))
                    .unwrap_or_default()
            };
            shape.meshes.push(Mesh {
                positions: self.floats(mesh, "p").as_chunks().0.to_vec(),
                normals: self.floats(mesh, "n").as_chunks().0.to_vec(),
                tangents: self.floats(mesh, "ta").as_chunks().0.to_vec(),
                uvs: self.floats(mesh, "u0").as_chunks().0.to_vec(),
                triangles: self
                    .ints(mesh, "tri")
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .map(|t| t.map(|i| u32::try_from(i).unwrap_or(u32::MAX)))
                    .collect(),
                material: Material {
                    shader: text("shader"),
                    diffuse: text("diff"),
                    normal: text("n"),
                    specular: text("spec"),
                },
            });
        }
        if let Some(skeleton) = self.child(id, "skeleton") {
            for &joint in &self.nodes[skeleton].children {
                let mut inverse_bind = [0.0; 12];
                let tx = self.floats(joint, "tx");
                if tx.len() >= 12 {
                    inverse_bind.copy_from_slice(&tx[..12]);
                } else {
                    inverse_bind[0] = 1.0;
                    inverse_bind[4] = 1.0;
                    inverse_bind[8] = 1.0;
                }
                shape.joints.push(Joint {
                    name: self.nodes[joint].name.clone(),
                    inverse_bind,
                });
            }
        }
        shape
    }

    fn child(&self, id: usize, name: &str) -> Option<usize> {
        self.children_named(id, name).next()
    }

    fn children_named<'a>(&'a self, id: usize, name: &'a str) -> impl Iterator<Item = usize> + 'a {
        self.nodes[id]
            .children
            .iter()
            .copied()
            .filter(move |&c| self.nodes[c].name == name)
    }

    fn prop(&self, id: usize, name: &str) -> Option<&Value> {
        let props = &self.nodes[id].props;
        props.iter().find(|(n, _)| n == name).map(|(_, v)| v)
    }

    fn floats(&self, id: usize, name: &str) -> &[f32] {
        match self.prop(id, name) {
            Some(Value::Floats(v)) => v,
            _ => &[],
        }
    }

    fn ints(&self, id: usize, name: &str) -> &[i32] {
        match self.prop(id, name) {
            Some(Value::Ints(v)) => v,
            _ => &[],
        }
    }

    fn string(&self, id: usize, name: &str) -> Option<String> {
        match self.prop(id, name) {
            Some(Value::Strings(v)) => v.first().cloned(),
            _ => None,
        }
    }
}

struct Reader<'a> {
    b: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn take(&mut self, len: usize) -> Result<&[u8], String> {
        let end = self.at.checked_add(len).ok_or("length overflows")?;
        let bytes = self
            .b
            .get(self.at..end)
            .ok_or_else(|| format!("truncated at {}", self.at))?;
        self.at = end;
        Ok(bytes)
    }

    fn u32(&mut self) -> Result<u32, String> {
        let bytes = self.take(4)?;
        Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn c_string(&mut self) -> Result<String, String> {
        let rest = self.b.get(self.at..).unwrap_or_default();
        let len = rest
            .iter()
            .position(|&c| c == 0)
            .ok_or_else(|| format!("unterminated name at {}", self.at))?;
        let name = String::from_utf8_lossy(&rest[..len]).into_owned();
        self.at += len + 1;
        Ok(name)
    }

    fn property(&mut self) -> Result<(String, Value), String> {
        let len = usize::from(self.take(1)?[0]);
        let name = String::from_utf8_lossy(self.take(len)?)
            .trim_end_matches('\0')
            .to_owned();
        let kind = self.take(1)?[0];
        let count = self.u32()? as usize;
        let value = match kind {
            b'i' => Value::Ints(self.words(count, |w| w as i32)?),
            b'f' => Value::Floats(self.words(count, f32::from_bits)?),
            b's' => {
                let mut strings = Vec::new();
                for _ in 0..count {
                    let len = self.u32()? as usize;
                    let s = self.take(len)?;
                    let s = s.strip_suffix(b"\0").unwrap_or(s);
                    strings.push(String::from_utf8_lossy(s).into_owned());
                }
                Value::Strings(strings)
            }
            other => return Err(format!("unknown property type {other:#x} in `{name}`")),
        };
        Ok((name, value))
    }

    fn words<T>(&mut self, count: usize, convert: impl Fn(u32) -> T) -> Result<Vec<T>, String> {
        let bytes = self.take(count.checked_mul(4).ok_or("count overflows")?)?;
        Ok(bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|w| convert(u32::from_le_bytes(*w)))
            .collect())
    }
}
