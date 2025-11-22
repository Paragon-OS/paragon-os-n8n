"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangleIcon, CheckIcon, XIcon } from "lucide-react";

export interface N8nConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowName: string;
  workflowDescription: string;
  parameters: Record<string, unknown>;
  onConfirm: () => void;
  onCancel: () => void;
}

export function N8nConfirmationDialog({
  open,
  onOpenChange,
  workflowName,
  workflowDescription,
  parameters,
  onConfirm,
  onCancel,
}: N8nConfirmationDialogProps) {
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!open) {
      setIsConfirming(false);
    }
  }, [open]);

  const handleConfirm = () => {
    setIsConfirming(true);
    onConfirm();
  };

  const handleCancel = () => {
    onCancel();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="size-5 text-yellow-500" />
            <DialogTitle>Confirm Workflow Execution</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            {workflowDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <h4 className="text-sm font-semibold mb-2">Workflow: {workflowName}</h4>
            <div className="rounded-md bg-muted p-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Parameters:
              </div>
              <pre className="text-xs overflow-auto max-h-48 whitespace-pre-wrap break-words">
                {JSON.stringify(parameters, null, 2)}
              </pre>
            </div>
          </div>

          <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900/50 p-3">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              This workflow will perform actions that may modify external systems
              (e.g., send messages). Please review the parameters before confirming.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isConfirming}
          >
            <XIcon className="size-4" />
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={handleConfirm}
            disabled={isConfirming}
          >
            <CheckIcon className="size-4" />
            {isConfirming ? "Executing..." : "Confirm & Execute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
