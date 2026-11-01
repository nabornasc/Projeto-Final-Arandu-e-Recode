import type { z } from 'zod';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  return schema.parse(data);
}
