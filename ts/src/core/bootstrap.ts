/**
 * Bootstrap – singleton container factory.
 * Mirrors Python src/core/bootstrap.py
 */
import { Container, buildContainer } from "./container";

let _container: Container | null = null;

export function getContainer(mode?: string): Container {
  if (!_container) {
    _container = buildContainer(mode);
  }
  return _container;
}

export function resetContainer(): void {
  _container = null;
}
