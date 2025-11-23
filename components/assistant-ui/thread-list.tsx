import type { FC } from "react";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAssistantState,
} from "@assistant-ui/react";
import { ArchiveIcon, PlusIcon, InfoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { useChatSessionsContext } from "@/components/assistant-ui/chat-sessions-context";

export const ThreadList: FC = () => {
  return (
    <ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col items-stretch gap-1.5">
      <ThreadListNew />
      <SupabaseThreadListItemsWrapper />
      <ThreadListItems />
    </ThreadListPrimitive.Root>
  );
};

const SupabaseThreadListItemsWrapper: FC = () => {
  try {
    return <SupabaseThreadListItems />;
  } catch {
    return null;
  }
};

const SupabaseThreadListItems: FC = () => {
  const {
    sessions,
    isLoading,
    activeSessionId,
    setActiveSessionId,
  } = useChatSessionsContext();

  if (isLoading) {
    return <ThreadListSkeleton />;
  }

  if (sessions.length === 0) {
    return null;
  }

  const handleSessionClick = (sessionId: string) => {
    setActiveSessionId(sessionId);
  };

  return (
    <>
      {sessions.map((session) => (
        <div
          key={session.session_id}
          className={`aui-thread-list-item flex items-center gap-2 rounded-lg transition-all hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none cursor-pointer ${
            activeSessionId === session.session_id ? "bg-muted" : ""
          }`}
          onClick={() => handleSessionClick(session.session_id)}
        >
          <div className="flex-grow px-3 py-2 text-start">
            <span className="aui-thread-list-item-title text-sm block truncate">
              {session.title || "Untitled Chat"}
            </span>
            {session.updated_at && (
              <span className="text-xs text-muted-foreground">
                {new Date(session.updated_at).toLocaleDateString()}
              </span>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="mr-3 ml-auto size-6 p-0 text-foreground hover:text-primary"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <InfoIcon className="size-4" />
                <span className="sr-only">View session JSON</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className="max-w-lg font-mono text-xs whitespace-pre-wrap break-words"
            >
              {JSON.stringify(session, null, 2)}
            </TooltipContent>
          </Tooltip>
        </div>
      ))}
    </>
  );
};

const ThreadListNew: FC = () => {
  let createNewSession: (() => string) | null = null;
  try {
    const context = useChatSessionsContext();
    createNewSession = context.createNewSession;
  } catch {
    // Context not available, will use default behavior
  }

  const handleNewThread = () => {
    if (createNewSession) {
      createNewSession();
    }
    // Default behavior will still work via ThreadListPrimitive.New
  };

  return (
    <ThreadListPrimitive.New asChild>
      <Button
        className="aui-thread-list-new flex items-center justify-start gap-1 rounded-lg px-2.5 py-2 text-start hover:bg-muted data-active:bg-muted"
        variant="ghost"
        onClick={handleNewThread}
      >
        <PlusIcon />
        New Thread
      </Button>
    </ThreadListPrimitive.New>
  );
};

const ThreadListItems: FC = () => {
  const isLoading = useAssistantState(({ threads }) => threads.isLoading);

  if (isLoading) {
    return <ThreadListSkeleton />;
  }

  return <ThreadListPrimitive.Items components={{ ThreadListItem }} />;
};

const ThreadListSkeleton: FC = () => {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          role="status"
          aria-label="Loading threads"
          aria-live="polite"
          className="aui-thread-list-skeleton-wrapper flex items-center gap-2 rounded-md px-3 py-2"
        >
          <Skeleton className="aui-thread-list-skeleton h-[22px] flex-grow" />
        </div>
      ))}
    </>
  );
};

const ThreadListItem: FC = () => {
  return (
    <ThreadListItemPrimitive.Root className="aui-thread-list-item flex items-center gap-2 rounded-lg transition-all hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-active:bg-muted">
      <ThreadListItemPrimitive.Trigger className="aui-thread-list-item-trigger flex-grow px-3 py-2 text-start">
        <ThreadListItemTitle />
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemArchive />
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemTitle: FC = () => {
  return (
    <span className="aui-thread-list-item-title text-sm">
      <ThreadListItemPrimitive.Title fallback="New Chat" />
    </span>
  );
};

const ThreadListItemArchive: FC = () => {
  return (
    <ThreadListItemPrimitive.Archive asChild>
      <TooltipIconButton
        className="aui-thread-list-item-archive mr-3 ml-auto size-4 p-0 text-foreground hover:text-primary"
        variant="ghost"
        tooltip="Archive thread"
      >
        <ArchiveIcon />
      </TooltipIconButton>
    </ThreadListItemPrimitive.Archive>
  );
};
