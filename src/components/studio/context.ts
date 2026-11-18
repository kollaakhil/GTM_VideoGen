"use client";

import { createContext, useContext } from "react";
import type { Ctx } from "./types";

export const FlowCtx = createContext<Ctx | null>(null);

export const useFlow = () => useContext(FlowCtx)!;
