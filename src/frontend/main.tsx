import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { LanguageProvider } from './i18n/LanguageContext';
import { FontSizeProvider } from './context/FontSizeContext';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <LanguageProvider>
      <FontSizeProvider>
        <App />
      </FontSizeProvider>
    </LanguageProvider>
  </React.StrictMode>
);
