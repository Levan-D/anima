/* What every part of the contract builds its commands from. Its own file, so the parts don't import each other. */
import * as z from 'zod';

/** A database id. */
export const id = z.int().positive();

/** A command: its input's schema, which main checks, and its output's type, which only the types carry. */
export const command =
  <Output>() =>
  <Input extends z.ZodType>(input: Input) => ({ input, output: undefined as unknown as Output });
