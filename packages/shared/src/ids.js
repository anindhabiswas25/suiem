import { v7 as uuidv7, validate, version } from "uuid";
/** UUIDv7: time-ordered internal identifiers (ARCHITECTURE §6). */
export function newId() {
  return uuidv7();
}
export function isUuidV7(value) {
  return typeof value === "string" && validate(value) && version(value) === 7;
}
