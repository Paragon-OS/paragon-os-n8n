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
  const isLoadingRef = useRef(false); // Track if we're currently loading to prevent concurrent loads
  const currentMessages = useAssistantState((state) => state.thread.messages);

  useEffect(() => {
    // Only load if we have a session and messages are loaded
    if (!activeSessionId || isLoading) {
      return;
    }

    // If we're already loading, skip to prevent concurrent loads
    if (isLoadingRef.current) {
      return;
    }

    // Check if this is a session switch (different session) or new messages in same session
    const isSessionSwitch = lastLoadedSessionId.current !== null && lastLoadedSessionId.current !== activeSessionId;
    const isSameSession = lastLoadedSessionId.current === activeSessionId;
    const isFirstLoad = lastLoadedSessionId.current === null;
    
    // If same session (not first load, not switching), check if there are new messages
    if (isSameSession && messages.length > 0) {
      const currentMessageIds = new Set((currentMessages || []).map((m) => m?.id).filter(Boolean));
      const newMessageIds = new Set(messages.map((m) => m?.id).filter(Boolean));
      
      // Check if all messages are already loaded
      const allMessagesLoaded = newMessageIds.size === currentMessageIds.size && 
                                Array.from(newMessageIds).every(id => currentMessageIds.has(id));
      
      if (allMessagesLoaded) {
        // All messages already loaded, skip
        return;
      }
      
      // There are new messages, continue to import them
      console.log(`[chat-session-loader] Same session but ${newMessageIds.size - currentMessageIds.size} new message(s) detected, will import`);
    } else if (isSameSession && messages.length === 0) {
      // Same session, no messages - skip
      return;
    }
    
    // For first load or session switch, continue to load messages
    // (isFirstLoad || isSessionSwitch cases fall through)


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
          // Set loading flag to prevent concurrent loads
          isLoadingRef.current = true;
          
          // Load messages into thread using import() - this is the ONLY safe method for historical messages
          // import() marks messages as historical and does NOT trigger responses
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

            // CRITICAL: Always use import() for ALL messages from Supabase
            // All messages from Supabase are historical and should NOT trigger responses
            // Never use append() as it will trigger responses for historical messages
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const threadAny = thread as any;

            // Check if thread supports import() - this is the only safe way to load historical messages
            if (typeof threadAny.import !== "function") {
              console.error("[chat-session-loader] Thread runtime does not support import(). Cannot load historical messages safely.");
              lastLoadedSessionId.current = activeSessionId;
              return;
            }

            // Clear thread first if switching sessions
            if (lastLoadedSessionId.current !== null && lastLoadedSessionId.current !== activeSessionId) {
              console.log(`[chat-session-loader] Switching sessions, resetting thread. Old: ${lastLoadedSessionId.current}, New: ${activeSessionId}`);
              thread.reset();
            }
            
            // Final validation: ensure all messages are valid objects with required fields
            const importMessages = safeMessages.filter((msg): msg is NonNullable<typeof msg> => {
              if (!msg || typeof msg !== "object") {
                console.warn("[chat-session-loader] Filtering out invalid message for import:", msg);
                return false;
              }
              // Ensure message has required id field
              if (!msg.id || typeof msg.id !== "string" || msg.id.trim() === "") {
                console.warn("[chat-session-loader] Filtering out message without valid id for import:", msg);
                return false;
              }
              // Ensure message has required role field
              if (!msg.role || !["user", "assistant", "system", "tool"].includes(msg.role)) {
                console.warn("[chat-session-loader] Filtering out message without valid role for import:", msg);
                return false;
              }
              return true;
            });
            
            if (importMessages.length === 0) {
              console.warn("[chat-session-loader] No valid messages to import after final validation");
              lastLoadedSessionId.current = activeSessionId;
              return;
            }
            
            // Check if we're reloading the same messages (avoid unnecessary re-import)
            const currentMessageIds = new Set((currentMessages || []).map((m) => m?.id).filter(Boolean));
            const importMessageIds = new Set(importMessages.map((m) => m?.id).filter(Boolean));
            
            // If all messages are already loaded, skip import
            if (importMessageIds.size === currentMessageIds.size && 
                Array.from(importMessageIds).every(id => currentMessageIds.has(id))) {
              console.log(`[chat-session-loader] All ${importMessages.length} messages already loaded, skipping import`);
              lastLoadedSessionId.current = activeSessionId;
              return;
            }
            
            // Final validation: Deep check each message before import
            const validatedImportMessages = importMessages.filter((msg, index): msg is NonNullable<typeof msg> => {
              try {
                if (!msg || typeof msg !== "object") {
                  console.error(`[chat-session-loader] Message at index ${index} is invalid:`, msg);
                  return false;
                }
                
                if (!msg.id || typeof msg.id !== "string" || msg.id.trim() === "") {
                  console.error(`[chat-session-loader] Message at index ${index} has invalid ID:`, msg);
                  return false;
                }
                
                if (!msg.role || !["user", "assistant", "system", "tool"].includes(msg.role)) {
                  console.error(`[chat-session-loader] Message at index ${index} has invalid role:`, msg);
                  return false;
                }
                
                // Validate toolInvocations array if present
                if (msg.toolInvocations) {
                  if (!Array.isArray(msg.toolInvocations)) {
                    console.error(`[chat-session-loader] Message at index ${index} has non-array toolInvocations:`, msg);
                    return false;
                  }
                  // Check each invocation has valid id
                  for (let i = 0; i < msg.toolInvocations.length; i++) {
                    const inv = msg.toolInvocations[i];
                    if (!inv || typeof inv !== "object" || Array.isArray(inv)) {
                      console.error(`[chat-session-loader] Message at index ${index}, toolInvocation at ${i} is invalid:`, inv);
                      return false;
                    }
                    const invObj = inv as Record<string, unknown>;
                    if (!invObj.id || typeof invObj.id !== "string" || invObj.id.trim() === "") {
                      console.error(`[chat-session-loader] Message at index ${index}, toolInvocation at ${i} has invalid id:`, inv);
                      return false;
                    }
                  }
                }
                
                // Validate toolCalls array if present
                if (msg.toolCalls) {
                  if (!Array.isArray(msg.toolCalls)) {
                    console.error(`[chat-session-loader] Message at index ${index} has non-array toolCalls:`, msg);
                    return false;
                  }
                  // Check each call has valid id
                  for (let i = 0; i < msg.toolCalls.length; i++) {
                    const call = msg.toolCalls[i];
                    if (!call || typeof call !== "object" || Array.isArray(call)) {
                      console.error(`[chat-session-loader] Message at index ${index}, toolCall at ${i} is invalid:`, call);
                      return false;
                    }
                    const callObj = call as Record<string, unknown>;
                    if (!callObj.id || typeof callObj.id !== "string" || callObj.id.trim() === "") {
                      console.error(`[chat-session-loader] Message at index ${index}, toolCall at ${i} has invalid id:`, call);
                      return false;
                    }
                  }
                }
                
                return true;
              } catch (validationErr) {
                console.error(`[chat-session-loader] Error validating message at index ${index}:`, validationErr, msg);
                return false;
              }
            });
            
            if (validatedImportMessages.length === 0) {
              console.error("[chat-session-loader] All messages failed validation, cannot import");
              isLoadingRef.current = false;
              return;
            }
            
            if (validatedImportMessages.length !== importMessages.length) {
              console.warn(`[chat-session-loader] Filtered out ${importMessages.length - validatedImportMessages.length} invalid messages before import`);
            }
            
            // Log message structure for debugging - with detailed content/parts inspection
            console.log(`[chat-session-loader] Importing ${validatedImportMessages.length} validated historical messages using import()`);
            console.log(`[chat-session-loader] Message IDs:`, validatedImportMessages.map(m => m?.id).filter(Boolean));
            console.log(`[chat-session-loader] Message roles:`, validatedImportMessages.map(m => m?.role).filter(Boolean));
            
            // Deep log content and parts for each message
            validatedImportMessages.forEach((msg, idx) => {
              console.log(`[chat-session-loader] Message ${idx} (ID: ${msg?.id}):`, {
                id: msg?.id,
                role: msg?.role,
                contentType: Array.isArray(msg?.content) ? 'array' : typeof msg?.content,
                contentLength: Array.isArray(msg?.content) ? msg.content.length : 'N/A',
                partsType: Array.isArray(msg?.parts) ? 'array' : typeof msg?.parts,
                partsLength: Array.isArray(msg?.parts) ? msg.parts.length : 'N/A',
                hasToolInvocations: Array.isArray(msg?.toolInvocations) && msg.toolInvocations.length > 0,
                hasToolCalls: Array.isArray(msg?.toolCalls) && msg.toolCalls.length > 0,
              });
              
              // Log content array structure in detail
              if (Array.isArray(msg?.content)) {
                console.log(`[chat-session-loader] Message ${idx} content array:`, JSON.stringify(msg.content, null, 2));
                msg.content.forEach((part: unknown, partIdx: number) => {
                  console.log(`[chat-session-loader] Message ${idx} content[${partIdx}]:`, {
                    type: typeof part,
                    isNull: part === null,
                    isUndefined: part === undefined,
                    isObject: typeof part === 'object' && part !== null,
                    hasId: typeof part === 'object' && part !== null && 'id' in (part as Record<string, unknown>),
                    value: part,
                  });
                });
              } else {
                console.log(`[chat-session-loader] Message ${idx} content (non-array):`, JSON.stringify(msg?.content));
              }
              
              // Log parts array structure in detail
              if (Array.isArray(msg?.parts)) {
                console.log(`[chat-session-loader] Message ${idx} parts array:`, JSON.stringify(msg.parts, null, 2));
                msg.parts.forEach((part: unknown, partIdx: number) => {
                  console.log(`[chat-session-loader] Message ${idx} parts[${partIdx}]:`, {
                    type: typeof part,
                    isNull: part === null,
                    isUndefined: part === undefined,
                    isObject: typeof part === 'object' && part !== null,
                    hasId: typeof part === 'object' && part !== null && 'id' in (part as Record<string, unknown>),
                    value: part,
                  });
                });
              } else if (msg?.parts !== undefined) {
                console.log(`[chat-session-loader] Message ${idx} parts (non-array):`, JSON.stringify(msg.parts));
              }
            });
            
            // Final validation: Clean content/parts arrays to remove null/undefined and ensure proper structure
            const finalCleanedMessages = validatedImportMessages.map((msg, idx) => {
              // Create a copy to avoid mutations
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const cleanedMsg: any = {
                id: msg.id,
                role: msg.role,
              };
              
              // Clean content array if present
              if (msg.content !== undefined) {
                if (Array.isArray(msg.content)) {
                  // Filter out null/undefined and ensure each element is valid
                  const cleanedContent = msg.content
                    .filter((part: unknown) => part !== null && part !== undefined)
                    .map((part: unknown) => {
                      // If part is an object without an id, ensure it's properly structured
                      if (typeof part === 'object' && part !== null && !Array.isArray(part)) {
                        const partObj = part as Record<string, unknown>;
                        // If it's a text part object, ensure it has the right structure
                        if (partObj.type === 'text' && typeof partObj.text === 'string') {
                          return part; // Already properly structured
                        }
                        // If it's a string, wrap it in a text part object
                        if (typeof part === 'string') {
                          return { type: 'text', text: part };
                        }
                        // Otherwise, return as-is (might be an attachment or other part type)
                        return part;
                      }
                      // If part is a string, wrap it in a text part object
                      if (typeof part === 'string') {
                        return { type: 'text', text: part };
                      }
                      return part;
                    });
                  
                  if (cleanedContent.length > 0) {
                    cleanedMsg.content = cleanedContent;
                  } else {
                    // If all content was filtered out, set to empty array
                    cleanedMsg.content = [];
                  }
                } else if (typeof msg.content === 'string' && msg.content.trim() !== '') {
                  // Convert string content to array format
                  cleanedMsg.content = [{ type: 'text', text: msg.content }];
                } else {
                  // Keep non-array content as-is
                  cleanedMsg.content = msg.content;
                }
              }
              
              // Clean parts array if present (similar to content)
              if (msg.parts !== undefined) {
                if (Array.isArray(msg.parts)) {
                  const cleanedParts = msg.parts
                    .filter((part: unknown) => part !== null && part !== undefined)
                    .map((part: unknown) => {
                      if (typeof part === 'object' && part !== null && !Array.isArray(part)) {
                        const partObj = part as Record<string, unknown>;
                        if (partObj.type === 'text' && typeof partObj.text === 'string') {
                          return part;
                        }
                        if (typeof part === 'string') {
                          return { type: 'text', text: part };
                        }
                        return part;
                      }
                      if (typeof part === 'string') {
                        return { type: 'text', text: part };
                      }
                      return part;
                    });
                  
                  if (cleanedParts.length > 0) {
                    cleanedMsg.parts = cleanedParts;
                  } else {
                    cleanedMsg.parts = [];
                  }
                } else if (typeof msg.parts === 'string' && msg.parts.trim() !== '') {
                  cleanedMsg.parts = [{ type: 'text', text: msg.parts }];
                } else {
                  cleanedMsg.parts = msg.parts;
                }
              }
              
              // Copy toolInvocations and toolCalls if present (already validated)
              if (Array.isArray(msg.toolInvocations) && msg.toolInvocations.length > 0) {
                cleanedMsg.toolInvocations = msg.toolInvocations;
              }
              if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
                cleanedMsg.toolCalls = msg.toolCalls;
              }
              
              return cleanedMsg;
            });
            
            // Log cleaned messages structure
            console.log(`[chat-session-loader] Final cleaned messages count:`, finalCleanedMessages.length);
            finalCleanedMessages.forEach((msg, idx) => {
              console.log(`[chat-session-loader] Cleaned message ${idx}:`, {
                id: msg?.id,
                role: msg?.role,
                contentLength: Array.isArray(msg?.content) ? msg.content.length : 'N/A',
                partsLength: Array.isArray(msg?.parts) ? msg.parts.length : 'N/A',
              });
            });
            
            try {
              // Import all messages at once - marks them as historical, won't trigger responses
              // This is the ONLY safe way to load historical messages from Supabase
              threadAny.import({ messages: finalCleanedMessages });
              console.log(`[chat-session-loader] Successfully imported ${finalCleanedMessages.length} historical messages (no responses triggered)`);
              
              // Mark session as loaded immediately after successful import
              lastLoadedSessionId.current = activeSessionId;
            } catch (importErr) {
              // CRITICAL: Do NOT fallback to append() - it will trigger responses for historical messages
              // If import() fails, log error and skip loading rather than risking duplicate responses
              console.error("[chat-session-loader] CRITICAL: Error during import() - NOT falling back to append() to prevent duplicate responses");
              console.error("[chat-session-loader] Error details:", importErr);
              console.error("[chat-session-loader] Error type:", importErr instanceof Error ? importErr.constructor.name : typeof importErr);
              console.error("[chat-session-loader] Error message:", importErr instanceof Error ? importErr.message : String(importErr));
              console.error("[chat-session-loader] Error stack:", importErr instanceof Error ? importErr.stack : "N/A");
              console.error("[chat-session-loader] Messages count:", finalCleanedMessages.length);
              console.error("[chat-session-loader] First message:", finalCleanedMessages[0]);
              console.error("[chat-session-loader] Last message:", finalCleanedMessages[finalCleanedMessages.length - 1]);
              console.error("[chat-session-loader] First message content:", JSON.stringify(finalCleanedMessages[0]?.content, null, 2));
              console.error("[chat-session-loader] First message parts:", JSON.stringify(finalCleanedMessages[0]?.parts, null, 2));
              console.error("[chat-session-loader] Last message content:", JSON.stringify(finalCleanedMessages[finalCleanedMessages.length - 1]?.content, null, 2));
              console.error("[chat-session-loader] Last message parts:", JSON.stringify(finalCleanedMessages[finalCleanedMessages.length - 1]?.parts, null, 2));
              // Log each message individually to identify the problematic one
              finalCleanedMessages.forEach((msg, idx) => {
                try {
                  // Try to serialize each message to catch any serialization issues
                  JSON.stringify(msg);
                } catch (serializeErr) {
                  console.error(`[chat-session-loader] Message at index ${idx} cannot be serialized:`, serializeErr, msg);
                }
              });
              // Don't mark as loaded so we can retry on next effect run
              // But clear loading flag to allow retry
              isLoadingRef.current = false;
            }
          } catch (err) {
            console.error("[chat-session-loader] Error loading messages into thread:", err);
            console.error("[chat-session-loader] Messages that caused error:", messages);
          } finally {
            // Always clear loading flag and mark session as loaded
            isLoadingRef.current = false;
            lastLoadedSessionId.current = activeSessionId;
          }
        } else {
          // Messages already loaded, just mark session as loaded
          lastLoadedSessionId.current = activeSessionId;
        }
      } else {
        // Even if no messages, mark this session as loaded
        isLoadingRef.current = false;
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
      isLoadingRef.current = false;
    }
  }, [activeSessionId]);

  return null; // This component doesn't render anything
}

