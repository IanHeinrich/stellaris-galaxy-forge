/** Disjoint sets over the indices 0..n-1, counting the sets left. */
export class UnionFind {
  private readonly parent: number[];
  components: number;

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.components = n;
  }

  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }

  union(i: number, j: number): boolean {
    const a = this.find(i);
    const b = this.find(j);
    if (a === b) return false;
    this.parent[a] = b;
    this.components--;
    return true;
  }
}
