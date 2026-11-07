"use client";

import { memo } from "react";
import { Handle, NodeProps, Position } from "reactflow";
import { CATEGORY_THEME, ServiceIcon } from "@/components/catalogue/icons";
import { getServiceDefinition } from "@/lib/catalogue/services";
import { SERVICE_NODE_SIZE, ServiceType } from "@/lib/graph/schema";

export type CanvasNodeData = {
  serviceType: ServiceType;
  name: string;
  resourceName: string;
};

function ServiceNodeInner({ data, selected }: NodeProps<CanvasNodeData>) {
  const def = getServiceDefinition(data.serviceType);
  const theme = CATEGORY_THEME[def.category];

  return (
    <div
      style={{ width: SERVICE_NODE_SIZE.width }}
      className={`group flex items-stretch overflow-hidden rounded-lg border bg-white shadow-sm transition-all dark:bg-zinc-900 ${
        selected ? theme.cardRingActive : theme.cardRing
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-zinc-400" />
      <span
        className={`flex h-full w-14 shrink-0 items-center justify-center ${theme.tile} ${theme.tileText}`}
      >
        <ServiceIcon type={data.serviceType} size={26} strokeWidth={1.75} aria-hidden />
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
