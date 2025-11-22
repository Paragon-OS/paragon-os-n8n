import { NextRequest, NextResponse } from "next/server";
import { getAllExecutions, listAllExecutionsWithDetails, getExecutionDetails } from "@/lib/n8n-client/execution";

export const dynamic = "force-dynamic";

/**
 * GET /api/debug/executions
 * List all executions from n8n with their details and events
 * 
 * Query parameters:
 * - limit: number of executions to fetch (default: 100)
 * - workflowId: filter by workflow ID (optional)
 * - executionId: get details for a specific execution (optional)
 * - details: include full execution data (default: true)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const workflowId = searchParams.get("workflowId") || undefined;
    const executionId = searchParams.get("executionId") || undefined;
    const includeDetails = searchParams.get("details") !== "false";

    // If specific execution ID requested, return just that one
    if (executionId) {
      console.log(`[debug-executions] Fetching details for execution: ${executionId}`);
      const execution = await getExecutionDetails(executionId);
      
      if (!execution) {
        return NextResponse.json(
          { error: `Execution ${executionId} not found` },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        execution: {
          id: execution.id,
          workflowId: execution.workflowId,
          status: execution.status,
          finished: execution.finished,
          startedAt: execution.startedAt,
          stoppedAt: execution.stoppedAt,
          mode: execution.mode,
          retryOf: execution.retryOf,
          retrySuccessId: execution.retrySuccessId,
          data: includeDetails ? execution.data : undefined,
        },
      });
    }

    // List all executions
    console.log(`[debug-executions] Fetching all executions (limit: ${limit}, workflowId: ${workflowId || "all"})`);
    
    if (includeDetails) {
      const executions = await listAllExecutionsWithDetails(limit, workflowId);
      
      return NextResponse.json({
        success: true,
        count: executions.length,
        executions: executions.map((exec) => ({
          id: exec.id,
          workflowId: exec.workflowId,
          status: exec.status,
          finished: exec.finished,
          startedAt: exec.startedAt,
          stoppedAt: exec.stoppedAt,
          mode: exec.mode,
          retryOf: exec.retryOf,
          // Include node execution data
          nodes: exec.data?.resultData?.runData 
            ? Object.keys(exec.data.resultData.runData).map((nodeId) => {
                const nodeData = exec.data?.resultData?.runData?.[nodeId];
                return {
                  nodeId,
                  executions: Array.isArray(nodeData) ? nodeData.length : 0,
                  data: includeDetails ? nodeData : undefined,
                };
              })
            : [],
          // Include error data if present
          error: exec.data?.error || (exec.fullData && typeof exec.fullData === "object" && "error" in exec.fullData ? (exec.fullData as { error?: unknown }).error : undefined),
          // Include full data if requested
          fullData: includeDetails ? exec.fullData : undefined,
        })),
      });
    } else {
      const executions = await getAllExecutions(limit, workflowId);
      
      return NextResponse.json({
        success: true,
        count: executions.length,
        executions: executions.map((exec) => ({
          id: exec.id,
          workflowId: exec.workflowId,
          status: exec.status,
          finished: exec.finished,
          startedAt: exec.startedAt,
          stoppedAt: exec.stoppedAt,
          mode: exec.mode,
          retryOf: exec.retryOf,
        })),
      });
    }
  } catch (error) {
    console.error("[debug-executions] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

