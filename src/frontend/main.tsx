import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './static/styles.css';

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(<App />);
}
