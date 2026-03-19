export class LogBuffer {
  private lines: string[] = [];
  private maxLines: number;

  constructor(maxLines = 500) {
    this.maxLines = maxLines;
  }

  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.maxLines) {
      this.lines.shift();
    }
  }

  pushMultiline(data: string): string[] {
    const newLines = data.split('\n').filter(l => l.length > 0);
    for (const line of newLines) {
      this.push(line);
    }
    return newLines;
  }

  getAll(): string[] {
    return [...this.lines];
  }

  clear(): void {
    this.lines = [];
  }

  get length(): number {
    return this.lines.length;
  }
}
