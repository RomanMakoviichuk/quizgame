import { Component } from "react";

/**
 * Keeps one scene's crash to that scene. Without it a render error anywhere
 * unmounts the whole app — the socket closes with it and the TV drops out of
 * the game. With it the scene goes blank (`fallback`), the app stays connected
 * and the next server event moves the game on. `resetKey` changing remounts it.
 */
export default class SceneGuard extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error(`[SceneGuard] ${this.props.name || "scene"} crashed:`, error);
  }

  componentDidUpdate(prev) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? this.props.fallback ?? null : this.props.children;
  }
}
