"use client";

import { memo } from "react";
import { Handle, NodeProps, Position } from "reactflow";
import { getServiceIcon, CATEGORY_THEME } from "@/lib/catalogue/icons";
import { getServiceDefinition } from "@/lib/catalogue/services";
import { ServiceType } from "@/lib/graph/schema";

export type ServiceNodeData = {
  serviceType: ServiceType;
  name: string;
  resourceName: string;
  selected: boolean;
};

function ServiceNodeInner({ data, selected }: NodeProps<ServiceNodeData>) {
  const def = getServiceDefinition(data.serviceType);
  const theme = CATEGORY_THEME[def.category];
  const Icon = getServiceIcon(data.serviceType);
  const active = selected || data.selected;

  return (
    <div
      className={`group flex w-[220px] items-stretch overflow-hidden rounded-lg border bg-white shadow-sm transition-all dark:bg-zinc-900 ${
        active ? theme.cardRingActive : theme.cardRing
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-zinc-400" />
      <span
        className={`flex h-full w-14 shrink-0 items-center justify-center ${theme.tile} ${theme.tileText}`}
      >
        <Icon size={26} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-2.5 py-2">
        <div className="truncate text-[12px] font-semibold leading-tight text-zinc-900 dark:text-zinc-50">
          {data.name}
        </div>
        <div className="truncate font-mono text-[10px] leading-tight text-zinc-500 dark:text-zinc-400">
          {def.shortLabel} - {data.resourceName}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-zinc-400" />
    </div>
  );
}

export const ServiceNode = memo(ServiceNodeInner);
