import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding: 40, fontFamily: "sans-serif", color: "#333"}}>
          <h1 style={{color: "red"}}>Something went wrong.</h1>
          <pre style={{background: "#f4f4f4", padding: 20, overflow: "auto", fontSize: 14}}>
            {this.state.error?.stack || this.state.error?.toString()}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Single Source of Truth for Firebase Config (.env) ───────────────────────
const envApiKey = import.meta.env.VITE_FIREBASE_API_KEY;
const envProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const envBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET;

// Set global window.FIREBASE_CONFIG from .env (with fallback)
window.FIREBASE_CONFIG = {
  apiKey: (envApiKey && envApiKey.trim()) || "AIzaSyD8S_dRHVNlmUnRV-AfOXocqR0EoPUh8k4",
  projectId: (envProjectId && envProjectId.trim()) || "vdiyagohilcharitable",
  bucket: (envBucket && envBucket.trim()) || "vdiyagohilcharitable.firebasestorage.app"
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
