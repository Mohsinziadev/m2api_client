let counter = 0;

/** Short, collision-resistant id for local entities. Not cryptographically secure. */
export function createId(prefix = 'id'): string {
  counter = (counter + 1) % 1679616;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(4, '0')}${Math.random().toString(36).slice(2, 6)}`;
}
