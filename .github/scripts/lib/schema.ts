// JSON Schema validation for the subset our schemas use: types, required, enum, items,
// additionalProperties: false, maxLength and pattern. No dependencies.
import { readJson } from './json.ts';

type SchemaType = 'object' | 'array' | 'string' | 'integer';
export type Schema = {
  type: SchemaType;
  enum?: readonly string[];
  required?: readonly string[];
  additionalProperties?: boolean;
  properties?: Record<string, Schema>;
  items?: Schema;
  maxLength?: number;
  pattern?: string;
};
type Validator = (value: unknown, schema: Schema, at: string) => string[];

// Schema paths resolve relative to this script; the schema files live in contracts/.
export const readSchema = (name: string): Schema => readJson<Schema>(new URL(name, import.meta.url));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateObject: Validator = (value, schema, at) => {
  if (!isPlainObject(value)) return [`${at}: expected object`];
  const missing = (schema.required ?? []).filter((key) => !(key in value)).map((key) => `${at}.${key}: required`);
  const properties = Object.entries(value).flatMap(([key, child]) => {
    const childSchema = schema.properties?.[key];
    if (childSchema) return validate(child, childSchema, `${at}.${key}`);
    return schema.additionalProperties === false ? [`${at}.${key}: unexpected property`] : [];
  });
  return [...missing, ...properties];
};

const validateArray: Validator = (value, schema, at) => {
  if (!Array.isArray(value)) return [`${at}: expected array`];
  const items = schema.items;
  return items ? value.flatMap((item, i) => validate(item, items, `${at}[${i}]`)) : [];
};

const validateString: Validator = (value, schema, at) => {
  if (typeof value !== 'string') return [`${at}: expected string`];
  const errors: string[] = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: "${value}" not one of ${schema.enum.join('|')}`);
  if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
  if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: "${value}" does not match ${schema.pattern}`);
  return errors;
};

const validators: Record<SchemaType, Validator> = {
  object: validateObject,
  array: validateArray,
  string: validateString,
  integer: (value, _schema, at) => (Number.isInteger(value) ? [] : [`${at}: expected integer`]),
};

// Every problem found, as "<path>: <problem>"; empty when the value is valid.
export function validate(value: unknown, schema: Schema, at = '$'): string[] {
  return validators[schema.type](value, schema, at);
}
