export type Clock = () => number;

export class ActionBudget {
  private readonly attempts: number[] = [];
  constructor(private readonly maxActionsPerMinute: number, private readonly clock: Clock = () => Date.now(), initialAttempts: number[] = []) {
    if (!Number.isInteger(maxActionsPerMinute) || maxActionsPerMinute < 1) throw new Error("maxActionsPerMinute は1以上の整数です");
    for (const timestamp of initialAttempts) if (Number.isFinite(timestamp) && timestamp >= 0) this.attempts.push(timestamp);
    this.attempts.sort((left, right) => left - right);
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
  /** resume時のrate budgetを復元するための、保持済みaction timestamp列。 */
  snapshot(): number[] { return [...this.attempts]; }
}
