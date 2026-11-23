import { append } from '../jsonl.mjs';
const [file, lock, n, id] = process.argv.slice(2);
for (let i = 0; i < Number(n); i++) await append(file, lock, { type: 'stress', proc: Number(id), i, pad: 'x'.repeat(200 + (i % 50)) });
