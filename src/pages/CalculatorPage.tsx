import { useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type CalcErrorCode = 'INVALID' | 'DIV_ZERO' | 'NAN';

class CalcError extends Error {
  code: CalcErrorCode;

  constructor(code: CalcErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

type Token =
  | { type: 'number'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '%' | '^' }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'comma' };

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'constant'; value: number }
  | { kind: 'variable' }
  | { kind: 'unary'; op: '+' | '-'; expr: Node }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '%' | '^'; left: Node; right: Node }
  | { kind: 'func'; name: string; args: Node[] };

type CalcResult =
  | { kind: 'idle'; message: string }
  | { kind: 'ok'; message: string }
  | { kind: 'warn'; message: string }
  | { kind: 'error'; message: string };

const EPS = 1e-10;

function isNearlyZero(value: number, eps = EPS) {
  return Math.abs(value) <= eps;
}

function toDisplayNumber(value: number) {
  if (!Number.isFinite(value)) {
    throw new CalcError('NAN');
  }
  if (isNearlyZero(value)) {
    return '0';
  }
  return Number(value.toFixed(12)).toString();
}

function tokenize(input: string): Token[] {
  const text = input.replace(/π/gi, 'pi');
  const tokens: Token[] = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[+\-*/%^]/.test(char)) {
      tokens.push({ type: 'op', value: char as Token & { type: 'op' }['value'] });
      index += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char });
      index += 1;
      continue;
    }

    if (char === ',') {
      tokens.push({ type: 'comma' });
      index += 1;
      continue;
    }

    if (/\d|\./.test(char)) {
      let end = index + 1;
      while (end < text.length && /[\d.]/.test(text[end])) {
        end += 1;
      }
      if (end < text.length && /[eE]/.test(text[end])) {
        end += 1;
        if (end < text.length && /[+\-]/.test(text[end])) {
          end += 1;
        }
        while (end < text.length && /\d/.test(text[end])) {
          end += 1;
        }
      }
      const numText = text.slice(index, end);
      const value = Number(numText);
      if (!Number.isFinite(value)) {
        throw new CalcError('INVALID');
      }
      tokens.push({ type: 'number', value });
      index = end;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let end = index + 1;
      while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) {
        end += 1;
      }
      tokens.push({ type: 'ident', value: text.slice(index, end).toLowerCase() });
      index = end;
      continue;
    }

    throw new CalcError('INVALID');
  }

  return tokens;
}

class Parser {
  private readonly tokens: Token[];
  private cursor = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Node {
    const node = this.parseExpression();
    if (!this.isEnd()) {
      throw new CalcError('INVALID');
    }
    return node;
  }

  private parseExpression(): Node {
    let node = this.parseTerm();
    while (true) {
      const token = this.peek();
      if (!token || token.type !== 'op' || (token.value !== '+' && token.value !== '-')) {
        return node;
      }
      this.next();
      const right = this.parseTerm();
      node = { kind: 'binary', op: token.value, left: node, right };
    }
  }

  private parseTerm(): Node {
    let node = this.parseUnary();
    while (true) {
      const token = this.peek();
      if (!token || token.type !== 'op' || (token.value !== '*' && token.value !== '/' && token.value !== '%')) {
        return node;
      }
      this.next();
      const right = this.parseUnary();
      node = { kind: 'binary', op: token.value, left: node, right };
    }
  }

  private parseUnary(): Node {
    const token = this.peek();
    if (token && token.type === 'op' && (token.value === '+' || token.value === '-')) {
      this.next();
      return { kind: 'unary', op: token.value, expr: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePower(): Node {
    let node = this.parsePrimary();
    const token = this.peek();
    if (token && token.type === 'op' && token.value === '^') {
      this.next();
      const right = this.parsePower();
      node = { kind: 'binary', op: '^', left: node, right };
    }
    return node;
  }

  private parsePrimary(): Node {
    const token = this.next();
    if (!token) {
      throw new CalcError('INVALID');
    }

    if (token.type === 'number') {
      return { kind: 'number', value: token.value };
    }

    if (token.type === 'ident') {
      if (token.value === 'x') {
        return { kind: 'variable' };
      }
      if (token.value === 'pi') {
        return { kind: 'constant', value: Math.PI };
      }
      if (token.value === 'e') {
        return { kind: 'constant', value: Math.E };
      }

      const maybeParen = this.peek();
      if (!maybeParen || maybeParen.type !== 'paren' || maybeParen.value !== '(') {
        throw new CalcError('INVALID');
      }
      this.next(); // (
      const args: Node[] = [];
      const close = this.peek();
      if (!close || close.type !== 'paren' || close.value !== ')') {
        while (true) {
          args.push(this.parseExpression());
          const separator = this.peek();
          if (separator && separator.type === 'comma') {
            this.next();
            continue;
          }
          break;
        }
      }

      const endParen = this.next();
      if (!endParen || endParen.type !== 'paren' || endParen.value !== ')') {
        throw new CalcError('INVALID');
      }
      return { kind: 'func', name: token.value, args };
    }

    if (token.type === 'paren' && token.value === '(') {
      const node = this.parseExpression();
      const endParen = this.next();
      if (!endParen || endParen.type !== 'paren' || endParen.value !== ')') {
        throw new CalcError('INVALID');
      }
      return node;
    }

    throw new CalcError('INVALID');
  }

  private peek() {
    return this.tokens[this.cursor];
  }

  private next() {
    const token = this.tokens[this.cursor];
    this.cursor += 1;
    return token;
  }

  private isEnd() {
    return this.cursor >= this.tokens.length;
  }
}

function applyFunction(name: string, args: number[]) {
  const ensureArity = (min: number, max = min) => {
    if (args.length < min || args.length > max) {
      throw new CalcError('INVALID');
    }
  };

  switch (name) {
    case 'log': {
      if (args.length === 1) {
        if (args[0] <= 0) {
          throw new CalcError('NAN');
        }
        return Math.log10(args[0]);
      }
      ensureArity(2, 2);
      const [value, base] = args;
      if (value <= 0 || base <= 0 || isNearlyZero(base - 1)) {
        throw new CalcError('NAN');
      }
      return Math.log(value) / Math.log(base);
    }
    case 'ln':
      ensureArity(1);
      if (args[0] <= 0) {
        throw new CalcError('NAN');
      }
      return Math.log(args[0]);
    case 'lg':
      ensureArity(1);
      if (args[0] <= 0) {
        throw new CalcError('NAN');
      }
      return Math.log10(args[0]);
    case 'sqrt':
      ensureArity(1);
      if (args[0] < 0) {
        throw new CalcError('NAN');
      }
      return Math.sqrt(args[0]);
    case 'abs':
      ensureArity(1);
      return Math.abs(args[0]);
    default:
      throw new CalcError('INVALID');
  }
}

function evaluate(node: Node, xValue?: number): number {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'constant':
      return node.value;
    case 'variable':
      if (typeof xValue !== 'number' || !Number.isFinite(xValue)) {
        throw new CalcError('INVALID');
      }
      return xValue;
    case 'unary': {
      const value = evaluate(node.expr, xValue);
      return node.op === '-' ? -value : value;
    }
    case 'binary': {
      const left = evaluate(node.left, xValue);
      const right = evaluate(node.right, xValue);
      switch (node.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          if (isNearlyZero(right)) {
            throw new CalcError('DIV_ZERO');
          }
          return left / right;
        case '%':
          if (isNearlyZero(right)) {
            throw new CalcError('DIV_ZERO');
          }
          return left % right;
        case '^': {
          const result = left ** right;
          if (!Number.isFinite(result) || Number.isNaN(result)) {
            throw new CalcError('NAN');
          }
          return result;
        }
        default:
          throw new CalcError('INVALID');
      }
    }
    case 'func': {
      const values = node.args.map(arg => evaluate(arg, xValue));
      const result = applyFunction(node.name, values);
      if (!Number.isFinite(result) || Number.isNaN(result)) {
        throw new CalcError('NAN');
      }
      return result;
    }
    default:
      throw new CalcError('INVALID');
  }
}

function containsVariable(node: Node): boolean {
  switch (node.kind) {
    case 'variable':
      return true;
    case 'unary':
      return containsVariable(node.expr);
    case 'binary':
      return containsVariable(node.left) || containsVariable(node.right);
    case 'func':
      return node.args.some(containsVariable);
    default:
      return false;
  }
}

type Poly = [number, number, number]; // c0 + c1*x + c2*x^2

function polyAdd(a: Poly, b: Poly): Poly {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function polySub(a: Poly, b: Poly): Poly {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function polyMul(a: Poly, b: Poly): Poly | null {
  const out = [0, 0, 0, 0, 0];
  for (let i = 0; i <= 2; i += 1) {
    if (isNearlyZero(a[i])) continue;
    for (let j = 0; j <= 2; j += 1) {
      if (isNearlyZero(b[j])) continue;
      out[i + j] += a[i] * b[j];
    }
  }
  if (!isNearlyZero(out[3]) || !isNearlyZero(out[4])) {
    return null;
  }
  return [out[0], out[1], out[2]];
}

function polyPow(base: Poly, exponent: number): Poly | null {
  if (!Number.isInteger(exponent) || exponent < 0) {
    return null;
  }
  if (exponent === 0) {
    return [1, 0, 0];
  }
  let result: Poly = [1, 0, 0];
  for (let i = 0; i < exponent; i += 1) {
    const next = polyMul(result, base);
    if (!next) {
      return null;
    }
    result = next;
  }
  return result;
}

function polyToDegree(poly: Poly) {
  if (!isNearlyZero(poly[2])) return 2;
  if (!isNearlyZero(poly[1])) return 1;
  return 0;
}

function toPolynomial(node: Node): Poly | null {
  switch (node.kind) {
    case 'number':
      return [node.value, 0, 0];
    case 'constant':
      return [node.value, 0, 0];
    case 'variable':
      return [0, 1, 0];
    case 'unary': {
      const inner = toPolynomial(node.expr);
      if (!inner) {
        return null;
      }
      return node.op === '-' ? [-inner[0], -inner[1], -inner[2]] : inner;
    }
    case 'binary': {
      const left = toPolynomial(node.left);
      const right = toPolynomial(node.right);
      if (!left || !right) {
        return null;
      }
      switch (node.op) {
        case '+':
          return polyAdd(left, right);
        case '-':
          return polySub(left, right);
        case '*':
          return polyMul(left, right);
        case '/':
        case '%':
          if (!isNearlyZero(right[1]) || !isNearlyZero(right[2])) {
            return null;
          }
          if (isNearlyZero(right[0])) {
            throw new CalcError('DIV_ZERO');
          }
          return [left[0] / right[0], left[1] / right[0], left[2] / right[0]];
        case '^': {
          if (!isNearlyZero(right[1]) || !isNearlyZero(right[2])) {
            return null;
          }
          return polyPow(left, right[0]);
        }
        default:
          return null;
      }
    }
    case 'func':
      return null;
    default:
      return null;
  }
}

function dedupeRoots(roots: number[]) {
  const sorted = [...roots].sort((a, b) => a - b);
  const output: number[] = [];
  for (const root of sorted) {
    if (output.length === 0 || Math.abs(root - output[output.length - 1]) > 1e-6) {
      output.push(root);
    }
  }
  return output;
}

function solvePolynomial(poly: Poly): { status: 'infinite' | 'none' | 'roots'; roots?: number[] } {
  const [c0, c1, c2] = poly;
  const degree = polyToDegree(poly);
  if (degree === 0) {
    return isNearlyZero(c0) ? { status: 'infinite' } : { status: 'none' };
  }
  if (degree === 1) {
    if (isNearlyZero(c1)) {
      return isNearlyZero(c0) ? { status: 'infinite' } : { status: 'none' };
    }
    return { status: 'roots', roots: [-c0 / c1] };
  }

  const delta = c1 * c1 - 4 * c2 * c0;
  if (delta < -EPS) {
    return { status: 'none' };
  }
  if (isNearlyZero(delta)) {
    return { status: 'roots', roots: [-c1 / (2 * c2)] };
  }
  const sqrtDelta = Math.sqrt(delta);
  const x1 = (-c1 - sqrtDelta) / (2 * c2);
  const x2 = (-c1 + sqrtDelta) / (2 * c2);
  return { status: 'roots', roots: dedupeRoots([x1, x2]) };
}

function safeEvaluate(node: Node, x: number): number | null {
  try {
    const value = evaluate(node, x);
    if (!Number.isFinite(value) || Number.isNaN(value)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function bisection(node: Node, left: number, right: number) {
  let l = left;
  let r = right;
  let fl = safeEvaluate(node, l);
  let fr = safeEvaluate(node, r);
  if (fl == null || fr == null) {
    return null;
  }
  if (Math.sign(fl) === Math.sign(fr)) {
    return null;
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = (l + r) / 2;
    const fm = safeEvaluate(node, mid);
    if (fm == null) {
      return null;
    }
    if (Math.abs(fm) <= 1e-9 || Math.abs(r - l) <= 1e-8) {
      return mid;
    }
    if (Math.sign(fl) !== Math.sign(fm)) {
      r = mid;
      fr = fm;
    } else {
      l = mid;
      fl = fm;
    }
  }

  const final = (l + r) / 2;
  const check = safeEvaluate(node, final);
  if (check == null || !Number.isFinite(check) || Number.isNaN(check)) {
    return null;
  }
  return final;
}

function solveNumerically(node: Node) {
  const roots: number[] = [];
  const start = -1000;
  const end = 1000;
  const step = 0.5;
  let prevX = start;
  let prevY = safeEvaluate(node, prevX);

  if (prevY != null && Math.abs(prevY) <= 1e-5) {
    roots.push(prevX);
  }

  for (let x = start + step; x <= end; x += step) {
    const y = safeEvaluate(node, x);
    if (y != null && Math.abs(y) <= 1e-5) {
      roots.push(x);
    }

    if (prevY != null && y != null && Math.sign(prevY) !== Math.sign(y)) {
      const root = bisection(node, prevX, x);
      if (typeof root === 'number') {
        roots.push(root);
      }
    }
    prevX = x;
    prevY = y;
  }

  return dedupeRoots(roots);
}

function mapCalcError(error: unknown) {
  if (error instanceof CalcError) {
    if (error.code === 'DIV_ZERO') {
      return '除数不能为零';
    }
    if (error.code === 'NAN') {
      return 'NaN';
    }
    return '式子不合法';
  }
  return '式子不合法';
}

function parseExpression(expression: string) {
  const tokens = tokenize(expression);
  if (tokens.length === 0) {
    throw new CalcError('INVALID');
  }
  const parser = new Parser(tokens);
  return parser.parse();
}

function calculate(input: string): CalcResult {
  const text = input.trim();
  if (!text) {
    return { kind: 'idle', message: '请输入表达式或一元方程（例如：2*(3+4) 或 x^2-5x+6=0）' };
  }

  try {
    const equalCount = (text.match(/=/g) || []).length;
    if (equalCount === 0) {
      const node = parseExpression(text);
      if (containsVariable(node)) {
        return { kind: 'warn', message: '表达式包含 x，请输入一元方程（含 =）' };
      }
      const value = evaluate(node);
      return { kind: 'ok', message: toDisplayNumber(value) };
    }

    if (equalCount !== 1) {
      throw new CalcError('INVALID');
    }

    const [leftText, rightText] = text.split('=');
    if (!leftText?.trim() || !rightText?.trim()) {
      throw new CalcError('INVALID');
    }

    const left = parseExpression(leftText);
    const right = parseExpression(rightText);
    const equation = { kind: 'binary', op: '-', left, right } as const;

    if (!containsVariable(equation)) {
      const value = evaluate(equation);
      return isNearlyZero(value)
        ? { kind: 'ok', message: '恒等式：任意实数都是解' }
        : { kind: 'warn', message: '无解' };
    }

    const poly = toPolynomial(equation);
    if (poly) {
      const solved = solvePolynomial(poly);
      if (solved.status === 'infinite') {
        return { kind: 'ok', message: '恒等式：任意实数都是解' };
      }
      if (solved.status === 'none' || !solved.roots || solved.roots.length === 0) {
        return { kind: 'warn', message: '无实数解' };
      }
      const rootText = solved.roots.map((root, idx) => `x${idx + 1}=${toDisplayNumber(root)}`).join('，');
      return { kind: 'ok', message: `方程解：${rootText}` };
    }

    const numericRoots = solveNumerically(equation);
    if (numericRoots.length === 0) {
      return { kind: 'warn', message: '无实数解（在扫描范围 [-1000, 1000] 内）' };
    }
    const rootText = numericRoots.map((root, idx) => `x${idx + 1}≈${toDisplayNumber(root)}`).join('，');
    return { kind: 'ok', message: `近似实数解：${rootText}` };
  } catch (error) {
    return { kind: 'error', message: mapCalcError(error) };
  }
}

export default function CalculatorPage() {
  const [expression, setExpression] = useState('');

  const result = useMemo(() => calculate(expression), [expression]);

  return (
    <DashboardLayout pageTitle="计算器">
      <div className="max-w-5xl mx-auto space-y-4">
        <Tabs value="arithmetic" className="space-y-4">
          <TabsList className="bg-secondary">
            <TabsTrigger value="arithmetic">算数计算机</TabsTrigger>
          </TabsList>

          <TabsContent value="arithmetic">
            <Card className="p-5 bg-card border-border space-y-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">表达式 / 一元方程</h3>
                <p className="text-xs text-muted-foreground">
                  支持 + - * / % ^ ( )、常量 pi/e、函数 log/ln/lg/sqrt/abs。输入方程时使用 x 和等号，例如：x^2-5x+6=0
                </p>
              </div>

              <Input
                value={expression}
                onChange={event => setExpression(event.target.value)}
                placeholder="请输入，如：2*(3+4)^2 或 x^2-5x+6=0"
                className="h-10 text-base"
              />

              <div className="rounded-lg border border-border/70 bg-secondary/20 p-4">
                <p className="text-xs text-muted-foreground mb-1">当前结果</p>
                <p
                  className={`text-lg font-semibold break-all ${
                    result.kind === 'error'
                      ? 'text-destructive'
                      : result.kind === 'warn'
                        ? 'text-amber-400'
                        : result.kind === 'ok'
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                  }`}
                >
                  {result.message}
                </p>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
