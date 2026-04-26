import { useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

interface LoginInstructionsProps {
  instructions: string;
  "data-testid"?: string;
}

/**
 * Extract a device code from OAuth login instructions.
 * Matches patterns like "GH-2469", "ABCD-1234", "1234-ABCD", etc.
 */
function extractDeviceCode(text: string): string | null {
  const match = text.match(/\bcode\s+([A-Z0-9]+(?:-[A-Z0-9]+)+)\b/i);
  return match?.[1] ?? null;
}

/**
 * Renders OAuth login instructions with a copy-to-clipboard button
 * for the device code when one is detected.
 */
export function LoginInstructions({ instructions, "data-testid": testId }: LoginInstructionsProps) {
  const [copied, setCopied] = useState(false);
  const deviceCode = extractDeviceCode(instructions);

  const handleCopy = useCallback(async () => {
    const textToCopy = deviceCode ?? instructions;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore copy failures
    }
  }, [deviceCode, instructions]);

  return (
    <p className="auth-login-instructions" data-testid={testId}>
      {deviceCode ? (
        <>
          {instructions.split(deviceCode).map((part, i, arr) => (
            <span key={i}>
              {part}
              {i < arr.length - 1 && (
                <span className="device-code-wrapper">
                  <code className="device-code">{deviceCode}</code>
                  <button
                    className="device-code-copy-btn"
                    onClick={handleCopy}
                    title={copied ? "Copied!" : "Copy code"}
                    aria-label={copied ? "Copied to clipboard" : "Copy device code"}
                    type="button"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </span>
              )}
            </span>
          ))}
        </>
      ) : (
        instructions
      )}
    </p>
  );
}
