import { stripEscape } from '../pty-utils';

describe('stripEscape', () => {
  it('returns empty string unchanged', () => {
    expect(stripEscape('')).toBe('');
  });

  it('passes through plain text', () => {
    expect(stripEscape('hello world')).toBe('hello world');
  });

  it('strips CSI color codes', () => {
    // \x1b[32m = green, \x1b[0m = reset
    expect(stripEscape('\x1b[32mgreen text\x1b[0m')).toBe('green text');
  });

  it('strips bold/underline CSI sequences', () => {
    expect(stripEscape('\x1b[1mbold\x1b[22m \x1b[4munderline\x1b[24m')).toBe('bold underline');
  });

  it('strips cursor movement CSI sequences', () => {
    // \x1b[2J = clear screen, \x1b[H = cursor home
    expect(stripEscape('\x1b[2J\x1b[Hhello')).toBe('hello');
  });

  it('strips CSI sequences with ? prefix (DEC private modes)', () => {
    // \x1b[?25h = show cursor, \x1b[?25l = hide cursor
    expect(stripEscape('\x1b[?25hvisible\x1b[?25l')).toBe('visible');
  });

  it('strips character set selection sequences', () => {
    expect(stripEscape('\x1b(B\x1b)0text')).toBe('text');
  });

  it('strips other ESC sequences (e.g. ESC=, ESC>)', () => {
    expect(stripEscape('\x1b=keypad\x1b>')).toBe('keypad');
  });

  it('strips control characters except newline', () => {
    expect(stripEscape('line1\nline2')).toBe('line1\nline2');
    expect(stripEscape('hello\x07world')).toBe('helloworld'); // BEL
    expect(stripEscape('a\x08b')).toBe('ab'); // BS
    expect(stripEscape('tab\there')).toBe('tabhere'); // HT (\x09)
  });

  it('strips carriage return', () => {
    expect(stripEscape('hello\r\nworld')).toBe('hello\nworld');
    expect(stripEscape('overwrite\rtext')).toBe('overwritetext');
  });

  it('strips DEL character (0x7F)', () => {
    expect(stripEscape('hello\x7fworld')).toBe('helloworld');
  });

  it('handles complex real-world terminal output', () => {
    // Simulate colored prompt: "user@host:~$ "
    const input = '\x1b[1;32muser@host\x1b[0m:\x1b[1;34m~\x1b[0m$ ';
    expect(stripEscape(input)).toBe('user@host:~$ ');
  });

  it('handles multiple nested escape sequences', () => {
    const input = '\x1b[38;5;196m\x1b[48;5;232mred on black\x1b[0m';
    expect(stripEscape(input)).toBe('red on black');
  });

  it('preserves newlines in multi-line output', () => {
    const input = '\x1b[32mline1\x1b[0m\nline2\n\x1b[31mline3\x1b[0m';
    expect(stripEscape(input)).toBe('line1\nline2\nline3');
  });
});
