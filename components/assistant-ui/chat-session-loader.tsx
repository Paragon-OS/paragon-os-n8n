/**
 * Chat Session Loader
 * Loads messages from Supabase when a session is selected
 */

"use client";

import { useEffect, useRef } from "react";
import { useChatMessages } from "@/lib/supabase/hooks/use-chat-messages";
import { useAssistantRuntime, useAssistantState } from "@assistant-ui/react";
import { useSessionStore } from "@/lib/stores/session-store";

export function ChatSessionLoader() {
  // Use Zustand store as single source of truth for activeSessionId
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const { messages, isLoading } = useChatMessages({
    sessionId: activeSessionId,
    enabled: !!activeSessionId,
  });
  const runtime = useAssistantRuntime();
  const lastLoadedSessionId = useRef<string | null>(null);
  const currentMessages = useAssistantState((state) => state.thread.messages);

  useEffect(() => {
    // Only load if we have a session, messages are loaded, and it's a different session
    if (!activeSessionId || isLoading) {
      return;
    }

    // If this is the same session we already loaded, skip
    if (lastLoadedSessionId.current === activeSessionId) {
      return;
    }


    try {
      // Get the current thread from runtime
      const thread = runtime.thread;
      
      if (!thread) {
        console.error("[chat-session-loader] Could not get thread");
        return;
      }

      if (messages.length > 0) {
        
        // Load messages into thread using runtime API
        const currentThreadMessages = currentMessages || [];
        
        // Check if messages are already loaded (avoid duplicate loading)
        const messagesAlreadyLoaded = 
          currentThreadMessages.length === messages.length &&
          messages.every((msg) =>
            currentThreadMessages.some((existingMsg) => existingMsg.id === msg.id)
          );

        if (!messagesAlreadyLoaded) {
          // Load messages into thread using the thread's import or append method
          try {
            // Validate and normalize messages before importing
            // Create a new array with only valid message objects
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const validMessages: any[] = [];
            
            for (let i = 0; i < messages.length; i++) {
              const msg = messages[i];
              
              // Skip null, undefined, or non-object messages
              if (!msg || typeof msg !== "object") {
                console.warn("[chat-session-loader] Skipping invalid message at index", i, ":", msg);
                continue;
              }
              
              // Create a new message object to avoid mutations
              // Cast to any to access all properties
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const msgAny = msg as any;
              
              // Start with minimal required fields - initialize arrays to prevent undefined errors
              // Ensure ID is always a valid non-empty string
              let messageId = msg.id;
              if (!messageId || typeof messageId !== "string" || messageId.trim() === "") {
                messageId = `msg-${activeSessionId}-${i}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              }
              
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const validMsg: any = {
                id: messageId,
                role: ["user", "assistant", "system", "tool"].includes(msg.role) ? msg.role : "user",
                // Always initialize arrays to prevent "cannot read id of undefined" errors
                toolInvocations: [],
                toolCalls: [],
              };
              
              // Handle content - prefer content over parts, but ensure it's a valid type
              if (msgAny.content !== undefined && msgAny.content !== null && msgAny.content !== "") {
                // Content can be string, array, or object
                if (typeof msgAny.content === "string" || Array.isArray(msgAny.content) || (typeof msgAny.content === "object" && msgAny.content !== null)) {
                  validMsg.content = msgAny.content;
                } else {
                  validMsg.content = "";
                }
              } else {
                // If no content, try to use parts as content
                if (msgAny.parts !== undefined && msgAny.parts !== null && msgAny.parts !== "") {
                  if (typeof msgAny.parts === "string") {
                    validMsg.content = msgAny.parts;
                  } else if (Array.isArray(msgAny.parts) && msgAny.parts.length > 0) {
                    // If parts is an array, use the first string element or convert to string
                    const firstPart = msgAny.parts[0];
                    validMsg.content = typeof firstPart === "string" ? firstPart : JSON.stringify(msgAny.parts);
                  } else {
                    validMsg.content = "";
                  }
                } else {
                  validMsg.content = "";
                }
              }
              
              // Convert content to array format if it's a string (toCreateMessage expects array)
              // This ensures compatibility with AI SDK's toCreateMessage function
              if (validMsg.content !== undefined && validMsg.content !== null && validMsg.content !== "") {
                if (typeof validMsg.content === "string") {
                  // Convert string to array format: [{ type: "text", text: content }]
                  validMsg.content = [{ type: "text", text: validMsg.content }];
                } else if (!Array.isArray(validMsg.content) && typeof validMsg.content === "object") {
                  // Wrap object in array
                  validMsg.content = [validMsg.content];
                }
                // If already an array, keep it as is
              }
              
              // Handle parts - only include if it's an array (assistant-ui expects arrays, not strings)
              // Don't include parts if it's just a string duplicate of content
              if (msgAny.parts !== undefined && msgAny.parts !== null && msgAny.parts !== "") {
                // Only include parts if it's an array (assistant-ui expects arrays for parts)
                if (Array.isArray(msgAny.parts)) {
                  // Validate array elements and filter out any invalid ones
                  const validParts = msgAny.parts.filter((part: unknown) => {
                    // Allow strings, objects, but filter out null/undefined
                    return part !== null && part !== undefined;
                  });
                  // Only include if we have valid parts and it's different from content
                  if (validParts.length > 0 && JSON.stringify(validParts) !== JSON.stringify(validMsg.content)) {
                    validMsg.parts = validParts;
                  }
                } else if (typeof msgAny.parts === "object" && msgAny.parts !== null) {
                  // Object parts - convert to array format
                  validMsg.parts = [msgAny.parts];
                }
                // If parts is a string, we've already used it as content, so don't duplicate
              }
              
              // Handle toolInvocations - must be array of objects with id
              if (msgAny.toolInvocations !== undefined && msgAny.toolInvocations !== null) {
                if (Array.isArray(msgAny.toolInvocations)) {
                  // Filter and validate tool invocations - ensure each is an object with required structure
                  const validInvocations = msgAny.toolInvocations.filter((inv: unknown) => {
                    // Must be an object
                    if (!inv || typeof inv !== "object" || Array.isArray(inv)) {
                      return false;
                    }
                    // Must have an id property (assistant-ui requires this)
                    const invObj = inv as Record<string, unknown>;
                    return invObj.id !== undefined && invObj.id !== null && typeof invObj.id === "string";
                  });
                  // Replace the empty array with valid invocations if any exist
                  if (validInvocations.length > 0) {
                    validMsg.toolInvocations = validInvocations;
                  }
                }
              }
              
              // Handle toolCalls - must be array of objects with id
              if (msgAny.toolCalls !== undefined && msgAny.toolCalls !== null) {
                if (Array.isArray(msgAny.toolCalls)) {
                  // Filter and validate tool calls - ensure each is an object with required structure
                  const validCalls = msgAny.toolCalls.filter((call: unknown) => {
                    // Must be an object
                    if (!call || typeof call !== "object" || Array.isArray(call)) {
                      return false;
                    }
                    // Must have an id property (assistant-ui requires this)
                    const callObj = call as Record<string, unknown>;
                    return callObj.id !== undefined && callObj.id !== null && typeof callObj.id === "string";
                  });
                  // Replace the empty array with valid calls if any exist
                  if (validCalls.length > 0) {
                    validMsg.toolCalls = validCalls;
                  }
                }
              }
              
              // Don't copy metadata properties directly to message - they might confuse assistant-ui
              // If we need metadata, it should be stored separately, not mixed into the message object
              
              // ID is already validated and set above, so we can safely push
              validMessages.push(validMsg);
            }

            if (validMessages.length === 0) {
              lastLoadedSessionId.current = activeSessionId;
              return;
            }
            
            // Ensure we have a clean array with no undefined/null entries
            // Also filter out messages with empty content (assistant-ui may not handle these well)
            const cleanMessages = validMessages.filter(msg => {
              if (!msg || msg === null || msg === undefined || !msg.id) {
                return false;
              }
              // Skip messages with empty content (they might cause issues in assistant-ui)
              // But allow messages with toolInvocations or toolCalls even if content is empty
              // Content is now always an array after conversion, so check array length
              const hasContent = msg.content && (
                Array.isArray(msg.content) 
                  ? msg.content.length > 0 
                  : (typeof msg.content === "string" ? msg.content.trim() !== "" : true)
              );
              const hasToolInvocations = msg.toolInvocations && Array.isArray(msg.toolInvocations) && msg.toolInvocations.length > 0;
              const hasToolCalls = msg.toolCalls && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0;
              
              // Keep message if it has content OR has tool invocations/calls
              return hasContent || hasToolInvocations || hasToolCalls;
            });
            
            if (cleanMessages.length === 0) {
              lastLoadedSessionId.current = activeSessionId;
              return;
            }

            // Clear existing messages first if switching sessions
            if (lastLoadedSessionId.current !== null && lastLoadedSessionId.current !== activeSessionId) {
              thread.reset();
            }

            // Final validation: Ensure all messages have valid, non-empty string IDs
            // Also validate nested structures (toolInvocations, toolCalls) to prevent undefined id errors
            const finalMessages = cleanMessages
              .map(msg => {
                // Skip null/undefined messages
                if (!msg || typeof msg !== "object") {
                  console.warn("[chat-session-loader] Skipping invalid message object:", msg);
                  return null;
                }
                
                // Create validated message object with only safe properties
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const validatedMsg: any = {
                  id: msg.id,
                  role: msg.role,
                };
                
                // Ensure message has valid ID
                if (!validatedMsg.id || typeof validatedMsg.id !== "string" || validatedMsg.id.trim() === "") {
                  console.warn("[chat-session-loader] Message missing valid ID, skipping:", msg);
                  return null;
                }
                
                // Copy content if present
                if (msg.content !== undefined) {
                  validatedMsg.content = msg.content;
                }
                
                // Copy parts if present
                if (msg.parts !== undefined) {
                  validatedMsg.parts = msg.parts;
                }
                
                // Validate and clean toolInvocations if present
                if (Array.isArray(msg.toolInvocations) && msg.toolInvocations.length > 0) {
                  const validInvocations = msg.toolInvocations.filter((inv: unknown) => {
                    if (!inv || typeof inv !== "object" || Array.isArray(inv)) {
                      return false;
                    }
                    const invObj = inv as Record<string, unknown>;
                    const hasValidId = invObj.id && typeof invObj.id === "string" && invObj.id.trim() !== "";
                    if (!hasValidId) {
                      console.warn("[chat-session-loader] Filtering toolInvocation with invalid ID:", inv);
                    }
                    return hasValidId;
                  });
                  if (validInvocations.length > 0) {
                    validatedMsg.toolInvocations = validInvocations;
                  }
                }
                
                // Validate and clean toolCalls if present
                if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
                  const validCalls = msg.toolCalls.filter((call: unknown) => {
                    if (!call || typeof call !== "object" || Array.isArray(call)) {
                      return false;
                    }
                    const callObj = call as Record<string, unknown>;
                    const hasValidId = callObj.id && typeof callObj.id === "string" && callObj.id.trim() !== "";
                    if (!hasValidId) {
                      console.warn("[chat-session-loader] Filtering toolCall with invalid ID:", call);
                    }
                    return hasValidId;
                  });
                  if (validCalls.length > 0) {
                    validatedMsg.toolCalls = validCalls;
                  }
                }
                
                return validatedMsg;
              })
              .filter((msg): msg is NonNullable<typeof msg> => msg !== null);

            if (finalMessages.length === 0) {
              console.warn("[chat-session-loader] No valid messages to load after ID validation");
              lastLoadedSessionId.current = activeSessionId;
              return;
            }

            // Final safety check: ensure no undefined/null values in array
            const safeMessages = finalMessages.filter((msg): msg is NonNullable<typeof msg> => {
              if (!msg || typeof msg !== "object") {
                console.warn("[chat-session-loader] Filtering out invalid message:", msg);
                return false;
              }
              if (!msg.id || typeof msg.id !== "string") {
                console.warn("[chat-session-loader] Filtering out message without valid ID:", msg);
                return false;
              }
              return true;
            });

            if (safeMessages.length === 0) {
              console.warn("[chat-session-loader] No safe messages to load after final validation");
              lastLoadedSessionId.current = activeSessionId;
              return;
            }

            // Detect capability once and execute
            // Use append as primary method since it's more reliable and handles errors better
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const threadAny = thread as any;

            if (typeof threadAny.append === "function") {
              // Use append as primary method - it's more reliable and handles errors better
              // IMPORTANT: Check existence before appending to avoid infinite loops and duplication
              const existingIds = new Set((currentMessages || []).map((m) => m?.id).filter(Boolean));
              
              for (let i = 0; i < safeMessages.length; i++) {
                const message = safeMessages[i];
                // Only append if message ID doesn't exist in current thread
                if (message && message.id && !existingIds.has(message.id)) {
                  try {
                    threadAny.append(message);
                  } catch (err) {
                    console.error(`[chat-session-loader] Error appending message ${i}:`, err);
                    console.error(`[chat-session-loader] Problematic message:`, JSON.stringify(message, null, 2));
                  }
                }
              }
            } else if (typeof threadAny.import === "function") {
              // Fallback to import if append doesn't exist
              try {
                threadAny.import({ messages: safeMessages });
              } catch (importErr) {
                console.error("[chat-session-loader] Error during batch import:", importErr);
                console.error("[chat-session-loader] Messages count:", safeMessages.length);
              }
            } else {
              console.error("[chat-session-loader] Thread runtime does not support import or append.");
            }
          } catch (err) {
            console.error("[chat-session-loader] Error loading messages into thread:", err);
            console.error("[chat-session-loader] Messages that caused error:", messages);
          }
        }

        lastLoadedSessionId.current = activeSessionId;
      } else {
        // Even if no messages, mark this session as loaded
        lastLoadedSessionId.current = activeSessionId;
      }
    } catch (error) {
      console.error("[chat-session-loader] Error loading session:", error);
    }
  }, [activeSessionId, isLoading, messages, runtime, currentMessages]);

  // Reset when session changes
  useEffect(() => {
    if (lastLoadedSessionId.current !== activeSessionId) {
      lastLoadedSessionId.current = null;
    }
  }, [activeSessionId]);

  return null; // This component doesn't render anything
}

