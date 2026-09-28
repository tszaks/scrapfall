import { useEffect, useRef } from "react";
import { heldCodes, installMappedInput } from "./input/remap";
export function useKeyboard() {
  const keys = useRef(heldCodes);
  useEffect(installMappedInput, []);
  return keys;
}
