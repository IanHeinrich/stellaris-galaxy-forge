//! Random numbers by SplitMix64: small, fast and fixed, so a seed means the same draw
//! whatever crate versions build it. Scenario seats, asteroid names and gamedata's generator
//! all draw from here.

/// SplitMix64's increment.
pub const GOLDEN: u64 = 0x9E37_79B9_7F4A_7C15;

/// SplitMix64's mix.
pub fn mix(z: u64) -> u64 {
    let z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    let z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// A number in `[0, 1)` from `seed` and `key`: the first draw of the stream they key.
pub fn unit(seed: u64, key: u32) -> f64 {
    Rng::new(seed ^ u64::from(key).wrapping_mul(GOLDEN)).unit()
}

/// A SplitMix64 stream.
#[derive(Debug, Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(GOLDEN);
        mix(self.0)
    }

    /// In `[0, 1)`.
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// In `[min, max]`; `min` when the bounds cross.
    pub fn int(&mut self, min: i64, max: i64) -> i64 {
        if max <= min {
            return min;
        }
        let span = max.abs_diff(min) + 1;
        min + (self.next_u64() % span) as i64
    }

    /// In `[low, high)`, for bounds given as a pair.
    pub fn between(&mut self, bounds: impl Into<(f64, f64)>) -> f64 {
        let (low, high) = bounds.into();
        self.range(low, high)
    }

    /// In `[low, high)`.
    pub fn range(&mut self, low: f64, high: f64) -> f64 {
        low + (high - low) * self.unit()
    }

    /// In `[low, high]`, drawing a number even when the bounds meet; `low`, drawing nothing,
    /// when they cross.
    pub fn count(&mut self, (low, high): (u64, u64)) -> usize {
        let Some(span) = high.checked_sub(low) else {
            return low as usize;
        };
        (low + self.next_u64() % (span + 1)) as usize
    }

    /// One of `items`, each alike; `None`, drawing nothing, when there are none.
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> Option<&'a T> {
        let last = i64::try_from(items.len().checked_sub(1)?).ok()?;
        let index = self.int(0, last);
        items.get(usize::try_from(index).ok()?)
    }

    /// One item, each as likely as its weight; `None` when no weight is above zero.
    pub fn weighted<'a, T>(&mut self, items: &'a [(T, f64)]) -> Option<&'a T> {
        let total: f64 = items.iter().map(|(_, w)| w.max(0.0)).sum();
        if total <= 0.0 {
            return None;
        }
        let mut pick = self.unit() * total;
        for (item, weight) in items {
            let weight = weight.max(0.0);
            if pick < weight {
                return Some(item);
            }
            pick -= weight;
        }
        items
            .iter()
            .rev()
            .find(|(_, w)| *w > 0.0)
            .map(|(item, _)| item)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_count_whose_bounds_cross_is_its_low_bound() {
        let mut rng = Rng::new(7);
        assert_eq!(rng.count((5, 2)), 5);
        assert_eq!(rng.int(5, 2), 5);
    }
}
