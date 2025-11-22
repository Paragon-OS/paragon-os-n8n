"use client";

import { useEffect, useState } from "react";
import { createSupabaseClient, getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase-config";
import { CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

interface TestResult {
  status: ConnectionStatus;
  message: string;
  details?: {
    url: string;
    hasAnonKey: boolean;
    error?: string;
    testQueryResult?: {
      healthCheck: string;
      statusCode: number;
      clientInitialized: boolean;
    };
  };
}

export function SupabaseTest() {
  const [testResult, setTestResult] = useState<TestResult>({
    status: "idle",
    message: "Click 'Test Connection' to verify Supabase setup",
  });

  const testConnection = async () => {
    setTestResult({
      status: "connecting",
      message: "Testing connection...",
    });

    const url = getSupabaseUrl();
    const anonKey = getSupabaseAnonKey();
    const hasAnonKey = !!anonKey;

    // Check if configuration is present
    if (!hasAnonKey) {
      setTestResult({
        status: "error",
        message: "Configuration Error: Missing Supabase Anon Key",
        details: {
          url,
          hasAnonKey: false,
          error: "NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is not set",
        },
      });
      return;
    }

    // Try to create client and test connection
    try {
      const client = createSupabaseClient();
      
      if (!client) {
        setTestResult({
          status: "error",
          message: "Failed to create Supabase client",
          details: {
            url,
            hasAnonKey: true,
            error: "Client creation returned null",
          },
        });
        return;
      }

      // Test connection using REST API health check
      // This is more reliable than querying tables that might not exist
      const healthResponse = await fetch(`${url}/rest/v1/`, {
        headers: {
          apikey: anonKey!,
          Authorization: `Bearer ${anonKey}`,
        },
      });

      if (!healthResponse.ok) {
        throw new Error(`Health check failed: ${healthResponse.status} ${healthResponse.statusText}`);
      }

      // Health check passed - connection is working
      setTestResult({
        status: "connected",
        message: "Connection successful!",
        details: {
          url,
          hasAnonKey: true,
          testQueryResult: {
            healthCheck: "passed",
            statusCode: healthResponse.status,
            clientInitialized: true,
          },
        },
      });
    } catch (error) {
      setTestResult({
        status: "error",
        message: "Connection failed",
        details: {
          url,
          hasAnonKey: true,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };

  // Auto-test on mount
  useEffect(() => {
    testConnection();
  }, []);

  const getStatusIcon = () => {
    switch (testResult.status) {
      case "connecting":
        return <Loader2 className="w-5 h-5 animate-spin text-blue-500" />;
      case "connected":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "error":
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const getStatusColor = () => {
    switch (testResult.status) {
      case "connecting":
        return "text-blue-500";
      case "connected":
        return "text-green-500";
      case "error":
        return "text-red-500";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Supabase Connection Test</h2>
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              <span className={`text-sm font-medium ${getStatusColor()}`}>
                {testResult.status === "idle" && "Ready"}
                {testResult.status === "connecting" && "Connecting..."}
                {testResult.status === "connected" && "Connected"}
                {testResult.status === "error" && "Error"}
              </span>
            </div>
          </div>
          <button
            onClick={testConnection}
            disabled={testResult.status === "connecting"}
            className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testResult.status === "connecting" ? "Testing..." : "Test Connection"}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status Message */}
        <div className="bg-card border rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-2">Status</h3>
          <p className="text-sm text-muted-foreground">{testResult.message}</p>
        </div>

        {/* Connection Details */}
        {testResult.details && (
          <div className="bg-card border rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold mb-2">Connection Details</h3>
            
            <div>
              <span className="text-xs text-muted-foreground font-medium">URL:</span>
              <code className="block mt-1 text-xs bg-muted px-2 py-1 rounded font-mono break-all">
                {testResult.details.url}
              </code>
            </div>

            <div>
              <span className="text-xs text-muted-foreground font-medium">Anon Key:</span>
              <div className="flex items-center gap-2 mt-1">
                {testResult.details.hasAnonKey ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-xs text-green-500">Configured</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-red-500" />
                    <span className="text-xs text-red-500">Not configured</span>
                  </>
                )}
              </div>
            </div>

            {testResult.details.testQueryResult && (
              <div>
                <span className="text-xs text-muted-foreground font-medium">Test Result:</span>
                <div className="mt-1 p-2 bg-muted rounded text-xs font-mono overflow-x-auto">
                  <pre className="whitespace-pre-wrap break-words">
                    {JSON.stringify(testResult.details.testQueryResult, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {testResult.details.error && (
              <div>
                <span className="text-xs text-muted-foreground font-medium">Error:</span>
                <div className="mt-1 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-500 font-mono break-words">
                  {testResult.details.error}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Configuration Help */}
        <div className="bg-muted border rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-2">Configuration</h3>
          <p className="text-xs text-muted-foreground mb-2">
            Add these environment variables to your <code className="bg-background px-1 py-0.5 rounded">.env.local</code> file:
          </p>
          <div className="space-y-1 text-xs font-mono bg-background p-2 rounded">
            <div>NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321</div>
            <div>NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here</div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Get your anon key by running:{" "}
            <code className="bg-background px-1 py-0.5 rounded">
              cd ~/Software/supabase && DOCKER_HOST=unix:///var/run/docker.sock supabase status
            </code>
          </p>
        </div>
      </div>
    </div>
  );
}

