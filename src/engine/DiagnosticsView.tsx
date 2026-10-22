import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Txt } from "../components/Txt";
import { diagnostics } from "./runtime";
export function DiagnosticsView() {
  const [value, setValue] = useState(() => diagnostics.snapshot());
  useEffect(
    () => diagnostics.subscribe(() => setValue(diagnostics.snapshot())),
    [],
  );
  if (!__DEV__) return null;
  return (
    <View style={{ padding: 20 }}>
      <Txt size={12}>{JSON.stringify(value, null, 2)}</Txt>
    </View>
  );
}
