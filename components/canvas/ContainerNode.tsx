"use client";

import { memo } from "react";
import { Handle, NodeProps, Position } from "reactflow";
import { getServiceIcon, CATEGORY_THEME } from "@/lib/catalogue/icons";
import { getServiceDefinition } from "@/lib/catalogue/services";
import { ServiceType } from "@/lib/graph/schema";

export type ContainerNodeData = {
  serviceType: ServiceType;
  name: string;
  resourceName: string;
  selected: boolean;
};

function ContainerNodeInner({ data, selected }: NodeProps<ContainerNodeData>) {
  const def = getServiceDefinition(data.serviceType);
  const theme = CATEGORY_THEME[def.category];
  const Icon = getServiceIcon(data.serviceType);
  const active = selected || data.selected;

  return (
    <div
      className={`group relative h-full w-full rounded-2xl border-2 border-dashed bg-white/30 backdrop-blur-[1px] transition-all dark:bg-zinc-900/30 ${
        active ? theme.cardRingActive : theme.cardRing
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-zinc-400" />
      <header
        className={`absolute -top-3 left-3 flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ${theme.tile} ${theme.tileText}`}
      >
        <Icon size={14} strokeWidth={2} aria-hidden />
        <span>{data.name}</span>
        <span className="font-mono text-[10px] opacity-70">- {data.resourceName}</span>
      </header>
      <Handle type="source" position={Position.Right} className="!bg-zinc-400" />
    </div>
  );
}

export const ContainerNode = memo(ContainerNodeInner);
