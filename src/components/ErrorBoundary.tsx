import { Component, type ReactNode } from 'react';

interface State {
  error?: Error;
}

/** Fängt unerwartete Fehler einer Seite ab, damit nicht die ganze App weiss bleibt. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty">
        <h3>Hoppla – hier ist etwas schiefgelaufen</h3>
        <p className="small">{this.state.error.message}</p>
        <button className="btn" onClick={() => this.setState({ error: undefined })}>
          Nochmal versuchen
        </button>
      </div>
    );
  }
}
