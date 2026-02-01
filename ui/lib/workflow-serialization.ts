import { LGraph, LGraphCanvas, LGraphNode, LiteGraph } from "@/lib/litegraph-index";

export interface WorkflowNode {
  id: string;
  type: string;
  inputs?: Record<string, any>;
  position?: { x: number; y: number };
  metadata?: Record<string, any>;
}

export interface WorkflowConnection {
  from: string;
  from_output: string;
  to: string;
  to_input: string;
}

export interface WorkflowGraph {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}

/**
 * Serialize a Litegraph graph to our workflow JSON format
 */
export function serializeGraph(graph: InstanceType<typeof LGraph>): WorkflowGraph {
  const nodes: WorkflowNode[] = [];
  const connections: WorkflowConnection[] = [];

  // Serialize nodes - access nodes array directly
  const graphNodes: InstanceType<typeof LGraphNode>[] = (graph as any)._nodes || [];
  for (const node of graphNodes) {
    const nodeData: WorkflowNode = {
      id: node.id.toString(),
      type: node.type || node.constructor.name,
      position: { x: node.pos[0], y: node.pos[1] },
      inputs: {},
      metadata: node.properties || {},
    };

    // Serialize input values
    if (node.inputs) {
      node.inputs.forEach((input: any) => {
        if (input && input.name) {
          // Store the input value if it exists
          const inputValue = input.value;
          if (inputValue !== undefined) {
            nodeData.inputs![input.name] = inputValue;
          }
        }
      });
    }

    nodes.push(nodeData);
  }

  // Serialize connections
  for (const node of graphNodes) {
    if (node.outputs) {
      node.outputs.forEach((output: any) => {
        if (output && output.links) {
          output.links.forEach((linkId: number) => {
            const link = graph.links[linkId];
            if (link) {
              const targetNode = graph.getNodeById(link.target_id);
              if (targetNode && output.name) {
                const targetInput = targetNode.inputs?.[link.target_slot];
                if (targetInput && targetInput.name) {
                  connections.push({
                    from: node.id.toString(),
                    from_output: output.name,
                    to: targetNode.id.toString(),
                    to_input: targetInput.name,
                  });
                }
              }
            }
          });
        }
      });
    }
  }

  return {
    id: "workflow-1",
    name: "Obelisk Workflow",
    nodes,
    connections,
  };
}

/**
 * Deserialize a workflow JSON to a Litegraph graph
 */
export function deserializeGraph(graph: InstanceType<typeof LGraph>, workflow: WorkflowGraph): void {
  // Ensure graph has clear method (safety check)
  if (graph && typeof graph.clear === "function") {
    graph.clear();
  }

  // Create nodes
  const nodeMap = new Map<string, InstanceType<typeof LGraphNode>>();
  workflow.nodes.forEach((nodeData) => {
    const node = LiteGraph.createNode(nodeData.type);
    if (node) {
      node.id = parseInt(nodeData.id);
      // Set position from workflow data
      const posX = nodeData.position?.x ?? 0;
      const posY = nodeData.position?.y ?? 0;
      node.pos = [posX, posY];
      
      // Set input values and properties
      if (nodeData.inputs) {
        Object.entries(nodeData.inputs).forEach(([key, value]) => {
          const input = node.inputs?.find((inp: any) => inp.name === key);
          if (input) {
            // It's an actual input slot
            (input as any).value = value;
          } else {
            // It's a property, not an input slot
            if (!node.properties) {
              node.properties = {};
            }
            node.properties[key] = value;
            // Also update widget if it exists
            const widgets = (node as any).widgets as any[];
            if (widgets) {
              const widget = widgets.find((w: any) => w.name === key);
              if (widget) {
                widget.value = value;
              }
            }
          }
        });
      }
      
      // Set properties/metadata - do this after inputs to ensure widgets get updated
      if (nodeData.metadata) {
        if (!node.properties) {
          node.properties = {};
        }
        node.properties = { ...node.properties, ...nodeData.metadata };
        // Update widgets for metadata properties
        const widgets = (node as any).widgets as any[];
        if (widgets) {
          Object.entries(nodeData.metadata).forEach(([key, value]) => {
            const widget = widgets.find((w: any) => w.name === key);
            if (widget) {
              widget.value = value;
            }
          });
        }
      }

      // Properties/metadata already handled above

      graph.add(node);
      nodeMap.set(nodeData.id, node);
    }
  });

  // Create connections - handle both formats (from/to and source_node/target_node)
  workflow.connections.forEach((conn: any) => {
    // Normalize IDs to strings for Map lookup
    const fromId = String(conn.from ?? conn.source_node ?? "");
    const toId = String(conn.to ?? conn.target_node ?? "");
    const fromOutputName = conn.from_output || conn.source_output;
    const toInputName = conn.to_input || conn.target_input;

    const fromNode = nodeMap.get(fromId);
    const toNode = nodeMap.get(toId);

    if (fromNode && toNode) {
      const fromOutput = fromNode.outputs?.find((out: any) => out.name === fromOutputName);
      const toInput = toNode.inputs?.find((inp: any) => inp.name === toInputName);

      if (fromOutput && toInput) {
        const outputSlot = (fromOutput as any).slot ?? fromNode.outputs?.indexOf(fromOutput);
        const inputSlot = (toInput as any).slot ?? toNode.inputs?.indexOf(toInput);
        // Validate slots are non-negative integers before connecting
        if (Number.isInteger(outputSlot) && outputSlot >= 0 && 
            Number.isInteger(inputSlot) && inputSlot >= 0) {
          fromNode.connect(outputSlot, toNode, inputSlot);
        }
      }
    }
  });
}
