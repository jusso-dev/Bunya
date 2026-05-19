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
      className="group flex w-[210px] items-stretch overflow-hidden rounded-lg border bg-white shadow-sm transition-all dark:bg-zinc-900"
      style={{
        borderColor: active ? theme.border : theme.soft,
        boxShadow: active ? `0 0 0 2px ${theme.border}` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: theme.border }} />
      <div
        className="flex w-14 shrink-0 items-center justify-center"
        style={{ background: theme.bg, color: theme.ink }}
      >
        <Icon width={28} height={28} style={{ color: theme.ink, display: "block" }} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-2.5 py-2">
        <div className="truncate text-[12px] font-semibold leading-tight text-zinc-900 dark:text-zinc-50">
          {data.name}
        </div>
        <div className="truncate font-mono text-[10px] leading-tight text-zinc-500 dark:text-zinc-400">
          {def.shortLabel} - {data.resourceName}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: theme.border }} />
    </div>
  );
}

export const ServiceNode = memo(ServiceNodeInner);
