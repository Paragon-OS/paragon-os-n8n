import { describe, it, expect } from 'vitest';
import {
  findWorkflowFile,
  parseExecutionOutput,
  extractWorkflowResults,
  type WorkflowFile
} from './test-helpers';

describe('findWorkflowFile', () => {
  const mockWorkflowFiles: WorkflowFile[] = [
    {
      path: '/workflows/workflow1.json',
      content: { id: 'Workflow1ID', name: 'Test Workflow 1' },
      basename: 'workflow1'
    },
    {
      path: '/workflows/workflow2.json',
      content: { id: 'Workflow2ID', name: 'Test Workflow 2' },
      basename: 'workflow2'
    },
    {
      path: '/workflows/[LAB] Demo.json',
      content: { name: 'Demo Workflow' },
      basename: '[LAB] Demo'
    },
    {
      path: '/workflows/no-id.json',
      content: {},
      basename: 'no-id'
    }
  ];

  it('should find workflow by ID', () => {
    const result = findWorkflowFile('Workflow1ID', mockWorkflowFiles);
    expect(result).toBe('/workflows/workflow1.json');
  });

  it('should find workflow by exact name', () => {
    const result = findWorkflowFile('Test Workflow 2', mockWorkflowFiles);
    expect(result).toBe('/workflows/workflow2.json');
  });

  it('should find workflow by basename', () => {
    const result = findWorkflowFile('workflow1', mockWorkflowFiles);
    expect(result).toBe('/workflows/workflow1.json');
  });

  it('should find workflow by basename without tag', () => {
    const result = findWorkflowFile('Demo', mockWorkflowFiles);
    expect(result).toBe('/workflows/[LAB] Demo.json');
  });

  it('should return undefined when workflow not found', () => {
    const result = findWorkflowFile('NonExistent', mockWorkflowFiles);
    expect(result).toBeUndefined();
  });

  it('should prioritize ID match over name match', () => {
    const filesWithSameName: WorkflowFile[] = [
      {
        path: '/workflows/file1.json',
        content: { id: 'ID1', name: 'SameName' },
        basename: 'file1'
      },
      {
        path: '/workflows/file2.json',
        content: { id: 'ID2', name: 'SameName' },
        basename: 'file2'
      }
    ];
    const result = findWorkflowFile('ID1', filesWithSameName);
    expect(result).toBe('/workflows/file1.json');
  });

  it('should handle empty workflow files array', () => {
    const result = findWorkflowFile('AnyWorkflow', []);
    expect(result).toBeUndefined();
  });

  it('should match basename with tag prefix', () => {
    const result = findWorkflowFile('[LAB] Demo', mockWorkflowFiles);
    expect(result).toBe('/workflows/[LAB] Demo.json');
  });
});

describe('parseExecutionOutput', () => {
  it('should parse JSON after separator line', () => {
    const stdout = `
Execution was successful:
====================================
{"status": "success", "data": {"result": "test"}}
`;
    const result = parseExecutionOutput(stdout);
    expect(result).toEqual({ status: 'success', data: { result: 'test' } });
  });

  it('should parse JSON without separator (fallback)', () => {
    const stdout = 'Some text before {"status": "success"} some text after';
    const result = parseExecutionOutput(stdout);
    expect(result).toEqual({ status: 'success' });
  });

  it('should handle multi-line JSON', () => {
    const stdout = `
====================================
{
  "status": "success",
  "data": {
    "nested": "value"
  }
}
`;
    const result = parseExecutionOutput(stdout);
    expect(result).toEqual({
      status: 'success',
      data: { nested: 'value' }
    });
  });

  it('should throw error when no JSON found', () => {
    const stdout = 'No JSON here at all';
    expect(() => parseExecutionOutput(stdout)).toThrow('No JSON found in execution output');
  });

  it('should handle separator at end of output', () => {
    const stdout = 'Text\n====================================\n';
    expect(() => parseExecutionOutput(stdout)).toThrow();
  });

  it('should handle separator with spaces', () => {
    const stdout = 'Text\n=== === ===\n{"result": "ok"}';
    const result = parseExecutionOutput(stdout);
    expect(result).toEqual({ result: 'ok' });
  });

  it('should handle JSON with whitespace', () => {
    const stdout = '   \n====================================\n   {"test": true}   \n';
    const result = parseExecutionOutput(stdout);
    expect(result).toEqual({ test: true });
  });

  it('should handle complex nested JSON', () => {
    const stdout = `====================================
{
  "data": {
    "resultData": {
      "runData": {
        "Run: TestWorkflow": [{"executionStatus": "success"}]
      }
    }
  }
}`;
    const result = parseExecutionOutput(stdout);
    if (
      typeof result === 'object' &&
      result !== null &&
      'data' in result &&
      typeof result.data === 'object' &&
      result.data !== null &&
      'resultData' in result.data &&
      typeof result.data.resultData === 'object' &&
      result.data.resultData !== null &&
      'runData' in result.data.resultData
    ) {
      const runData = result.data.resultData.runData as Record<
        string,
        unknown
      >;
      expect(runData['Run: TestWorkflow']).toBeDefined();
    } else {
      throw new Error('Expected full execution JSON format');
    }
  });
});

describe('extractWorkflowResults', () => {
  it('should extract successful workflow output', () => {
    const executionJson = {
      data: {
        resultData: {
          runData: {
            'Run: TestWorkflow': [{
              executionStatus: 'success',
              data: {
                main: [[{
                  json: { result: 'test output' }
                }]]
              }
            }]
          }
        }
      }
    };

    const result = extractWorkflowResults(executionJson);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ result: 'test output' });
  });

  it('should handle empty output', () => {
    const executionJson = {
      data: {
        resultData: {
          runData: {
            'Run: TestWorkflow': [{
              executionStatus: 'success',
              data: {
                main: [[]]
              }
            }]
          }
        }
      }
    };

    const result = extractWorkflowResults(executionJson);
    expect(result.success).toBe(true);
    expect(result.output).toBeNull();
  });

  it('should detect workflow execution errors', () => {
    const executionJson = {
      data: {
        resultData: {
          runData: {
            'Run: TestWorkflow': [{
              executionStatus: 'error',
              error: {
                message: 'Workflow failed'
              }
            }]
          }
        }
      }
    };

    const result = extractWorkflowResults(executionJson);
    expect(result.success).toBe(false);
    // Implementation includes node name in error message for better context
    expect(result.error).toBe('Error in Run: TestWorkflow: Workflow failed');
    expect(result.errorDetails).toEqual({ message: 'Workflow failed' });
  });

  it('should handle missing workflow execution node', () => {
    const executionJson = {
      data: {
        resultData: {
          runData: {
            'SomeOtherNode': []
          }
        }
      }
    };

    const result = extractWorkflowResults(executionJson);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Workflow execution node not found');
  });

  it('should detect errors in other nodes', () => {
    const executionJson = {
      data: {
        resultData: {
          runData: {
            'ErrorNode': [{
              executionStatus: 'error',
              error: {
                message: 'Node error'
              }
            }]
          }
        }
      }
    };

    const result = extractWorkflowResults(executionJson);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Error in ErrorNode');
    expect(result.error).toContain('Node error');
  });

  it('should handle missing execution data', () => {
    const executionJson = {};

    const result = extractWorkflowResults(executionJson);
    expect(result.success).toBe(false);
    expect(result.error).toBe('No execution data found');
  });

  it('should handle malformed JSON gracefully', () => {
    const executionJson = null;

    const result = extractWorkflowResults(executionJson);
    expect(result.success).toBe(false);
    // null is handled by the first check, returning "No execution data found"
    expect(result.error).toBe('No execution data found');
  });

  it('should handle JSON parsing errors in try/catch', () => {
    // Create a malformed object that will cause an error during processing
    const executionJson = {
      data: {
        resultData: {
          runData: {
            'Run: TestWorkflow': [{
              executionStatus: 'success',
              data: {
                // This structure will cause issues when accessing nested properties
                main: [null] // null instead of array will cause issues
              }
            }]
          }
        }
      }
    };

    const result = extractWorkflowResults(executionJson);
    // Should handle gracefully without throwing
    expect(result.success).toBeDefined();
  });

  it('should handle error without message', () => {
    const executionJson = {
      data: {
        resultData: {
          runData: {
            'Run: TestWorkflow': [{
              executionStatus: 'error',
              error: 'Simple error string'
            }]
          }
        }
      }
    };

    const result = extractWorkflowResults(executionJson);
    expect(result.success).toBe(false);
    // Implementation includes node name in error message for better context
    expect(result.error).toBe('Error in Run: TestWorkflow: Simple error string');
  });

  it('should handle error with unknown format', () => {
    const executionJson = {
      data: {
        resultData: {
          runData: {
            'Run: TestWorkflow': [{
              executionStatus: 'error'
            }]
          }
        }
      }
    };

    const result = extractWorkflowResults(executionJson);
    expect(result.success).toBe(false);
    // Implementation includes node name and uses 'Unknown error' when error format is unknown
    expect(result.error).toBe('Error in Run: TestWorkflow: Unknown error');
  });

  it('should handle empty workflow node data', () => {
    const executionJson = {
      data: {
        resultData: {
          runData: {
            'Run: TestWorkflow': []
          }
        }
      }
    };

    const result = extractWorkflowResults(executionJson);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Workflow execution data is empty');
  });

  it('should handle missing main data array', () => {
    const executionJson = {
      data: {
        resultData: {
          runData: {
            'Run: TestWorkflow': [{
              executionStatus: 'success',
              data: {}
            }]
          }
        }
      }
    };

    const result = extractWorkflowResults(executionJson);
    expect(result.success).toBe(true);
    expect(result.output).toBeNull();
  });

  it('should handle multiple items in output array', () => {
    const executionJson = {
      data: {
        resultData: {
          runData: {
            'Run: TestWorkflow': [{
              executionStatus: 'success',
              data: {
                main: [[{
                  json: { first: 'item' }
                }, {
                  json: { second: 'item' }
                }]]
              }
            }]
          }
        }
      }
    };

    const result = extractWorkflowResults(executionJson);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ first: 'item' });
  });
});

