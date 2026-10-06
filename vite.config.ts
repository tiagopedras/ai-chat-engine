import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/* Two builds from one source.

   `vite build` is the component: an ES module with React, react-dom and Tenon
   left external, for an app that has its own copies and its own bundler.

   `vite build --mode bundle` is the drop-in: one classic script that carries
   React and Tenon inside it and hangs `AIChat` on window, for a page with no
   build step, which is how this package was always loaded. Everything a page
   used to get from chat.js it gets from dist/ai-chat.js.

   Neither carries CSS in the script. Both emit one chat.css beside it,
   because half of a page like the board is markup written in strings and can
   only reach styles that are in the cascade. */
export default defineConfig(({ mode }) => {
  const bundle = mode === 'bundle';
  return {
    plugins: [react()],
    /* One copy of React, always. Tenon is linked from a sibling folder while
       it is under development, and its own node_modules would otherwise bring
       a second copy into the bundle, where hooks fail with "reading useRef of
       null". */
    resolve: { dedupe: ['react', 'react-dom'] },
    /* Vite substitutes process.env.NODE_ENV for an app build but leaves it
       alone in lib mode, so without this the bundle carries React's
       development build and references to `process`, which a browser does not
       have. */
    define: bundle ? { 'process.env.NODE_ENV': JSON.stringify('production') } : undefined,
    build: {
      outDir: bundle ? 'dist' : 'dist/react',
      emptyOutDir: false,
      cssCodeSplit: false,
      lib: bundle
        ? { entry: resolve(__dirname, 'src/bundle.ts'), name: 'AIChatBundle', formats: ['iife' as const], fileName: () => 'ai-chat.js' }
        : { entry: resolve(__dirname, 'src/index.ts'), formats: ['es' as const], fileName: () => 'index.js' },
      rollupOptions: {
        /* thinking-orbs is a dependency rather than a peer, so an app gets it
           installed alongside and the component leaves it out too. */
        external: bundle ? [] : ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', '@tiagopedras/tenon', 'thinking-orbs'],
        output: { assetFileNames: (info) => (info.names?.[0]?.endsWith('.css') ? 'chat.css' : '[name][extname]') },
      },
    },
  };
});
