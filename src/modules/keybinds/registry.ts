/**
 * registry.ts — ActionRegistry: maps ActionId → ActionHandler.
 *
 * Skeleton for PR1: provides register/get/has methods.
 * Full IDisposable returns (REQ-KB-018, REQ-KB-022) completed in T2.3.
 *
 * Design §1.1 (registry.ts — Map<ActionId, ActionHandler> with subscribe API).
 */

import type { ActionId, ActionHandler, IDisposable } from "./types";

export class ActionRegistry {
  private readonly _handlers = new Map<ActionId, ActionHandler>();

  /**
   * Register a handler for an action ID.
   * Returns an IDisposable that removes the handler when disposed.
   *
   * Late registration is supported (REQ-KB-021): the handler is invoked
   * on the next chord match without restarting the engine.
   */
  register(id: ActionId, handler: ActionHandler): IDisposable {
    this._handlers.set(id, handler);

    return {
      dispose: () => {
        // Only remove if this specific handler is still registered
        // (prevents a later registration from being accidentally removed)
        if (this._handlers.get(id) === handler) {
          this._handlers.delete(id);
        }
      },
    };
  }

  /**
   * Retrieve the registered handler for an action ID, or undefined if none.
   */
  get(id: ActionId): ActionHandler | undefined {
    return this._handlers.get(id);
  }

  /**
   * Check if a handler is registered for the given action ID.
   */
  has(id: ActionId): boolean {
    return this._handlers.has(id);
  }

  /**
   * Remove all registered handlers. Used by engine.detach() to clean up.
   */
  clear(): void {
    this._handlers.clear();
  }
}
