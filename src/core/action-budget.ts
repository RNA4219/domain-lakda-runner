export type Clock = () => number;

export class ActionBudget {
  private readonly attempts: number[] = [];
  constructor(private readonly maxActionsPerMinute: number, private readonly clock: Clock = () => Date.now()) {
    if (!Number.isInteger(maxActionsPerMinute) || maxActionsPerMinute < 1) throw new Error("maxActionsPerMinute は1以上の整数です");
  }

  private prune(): void {
    const threshold = this.clock() - 60_000;
    while (this.attempts[0] !== undefined && this.attempts[0] <= threshold) this.attempts.shift();
  }

  canConsume(): boolean {
    this.prune();
    return this.attempts.length < this.maxActionsPerMinute;
  }

  tryConsume(): boolean {
    if (!this.canConsume()) return false;
    this.attempts.push(this.clock());
    return true;
  }

  get count(): number { this.prune(); return this.attempts.length; }
  get limit(): number { return this.maxActionsPerMinute; }
}