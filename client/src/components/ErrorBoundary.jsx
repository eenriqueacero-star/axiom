import React from 'react';

/**
 * Last line of defense. Without this, any uncaught render error (a bad prop, a
 * canvas math bug like Core.jsx's negative-radius crash) takes the ENTIRE app
 * to a blank black screen with zero indication anything went wrong — a user
 * just sees a dead page. This catches it, shows a real message, and offers a
 * reload instead of silence.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-950 text-neutral-100 px-6">
        <div className="max-w-sm text-center space-y-4">
          <p className="font-mono text-xs tracking-widest uppercase text-red-400">Something broke</p>
          <p className="text-sm text-neutral-400">
            {this.props.label || 'This view'} hit an error and couldn’t render. Your data is safe — this is just a display bug.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="text-xs font-mono px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 text-neutral-300"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
