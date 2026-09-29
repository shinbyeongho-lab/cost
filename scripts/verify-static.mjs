import { access } from 'node:fs/promises';

const required = [
  'dist/index.html',
  'dist/assets/app.js',
  'dist/assets/styles.css',
  'dist/assets/budget-editor.css',
  'dist/favicon.svg'
];

await Promise.all(required.map((file) => access(file)));
console.log('Bloom Budget static bundle is ready in dist.');
