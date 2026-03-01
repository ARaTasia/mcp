import { describe, it, expect } from 'vitest';

// Replicate the helper functions used in both tool files
function ok(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): { isError: true; content: [{ type: 'text'; text: string }] } {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

describe('MCP response format', () => {
  describe('ok()', () => {
    it('wraps data in content array with text type', () => {
      const result = ok({ id: '123', title: 'test' });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });

    it('serializes data as JSON', () => {
      const data = { id: '123', tags: ['a', 'b'] };
      const result = ok(data);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(data);
    });

    it('serializes arrays', () => {
      const result = ok([{ id: '1' }, { id: '2' }]);
      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });

    it('does not include isError flag', () => {
      const result = ok({});
      expect(result).not.toHaveProperty('isError');
    });
  });

  describe('err()', () => {
    it('wraps message in content array with text type', () => {
      const result = err('Task not found: xyz');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });

    it('includes isError: true flag', () => {
      const result = err('something went wrong');
      expect(result.isError).toBe(true);
    });

    it('passes error message verbatim', () => {
      const message = 'Circular prerequisite detected';
      const result = err(message);
      expect(result.content[0].text).toBe(message);
    });
  });
});
