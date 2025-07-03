import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Eye,
  Ear,
  Bug,
  Hand,
  Brain,
  Search,
} from "lucide-react";
import { Groq } from "groq-sdk";

const AccessibilityTestingApp = () => {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const [solutions, setSolutions] = useState({});
  const [loadingSolutions, setLoadingSolutions] = useState({});
  const [logs, setLogs] = useState([]); // For debugging logs

  // Add log message
  const addLog = (message) => {
    const timestamp = new Date().toISOString();
    setLogs((prev) => [...prev, `${timestamp}: ${message}`]);
    console.log(message); // Also log to console
  };

  // AI API call for solutions using Groq SDK
  const getAISolution = async (issue, description, html) => {
    const solutionKey = `${issue}-${description.substring(0, 20)}`;
    addLog(`Starting AI solution generation for issue: ${issue}`);

    try {
      addLog("Fetching Groq API key from backend...");
      const keyResponse = await fetch("http://localhost:5000/api/groq-key");

      if (!keyResponse.ok) {
        throw new Error(`Failed to get Groq API key: ${keyResponse.status}`);
      }

      const { apiKey } = await keyResponse.json();
      if (!apiKey) {
        throw new Error("No Groq API key returned from backend");
      }

      addLog("Initializing Groq client...");
      const groq = new Groq({
        apiKey: apiKey,
        dangerouslyAllowBrowser: true,
      });

      addLog("Creating chat completion...");
      const prompt = `Provide a concise solution for this accessibility issue without any reasoning steps or thinking process. Just provide:
      
      1. The specific fix (actionable solution)
      2. Code examples if applicable
      3. Why this fix is important
      4. Who it helps most
      
      Issue: ${issue}
      Description: ${description}
      HTML Element: ${html}`;

      // First try streaming approach
      try {
        const streamResponse = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content:
                "You are an accessibility expert. Provide direct solutions without showing your thinking process.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          model: "qwen/qwen3-32b",
          temperature: 0.6,
          stream: true,
          max_tokens: 1024,
        });

        let streamedContent = "";
        addLog("Processing streaming response...");
        for await (const chunk of streamResponse) {
          const content = chunk.choices[0]?.delta?.content || "";
          streamedContent += content;
          setSolutions((prev) => ({
            ...prev,
            [solutionKey]: streamedContent,
          }));
        }
        return streamedContent;
      } catch (streamError) {
        addLog(
          `Streaming failed, falling back to non-streaming: ${streamError.message}`
        );

        // Fallback to non-streaming approach
        const response = await groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content:
                "You are an accessibility expert. Provide direct solutions without showing your thinking process.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          model: "qwen/qwen3-32b",
          temperature: 0.6,
          stream: false,
          max_tokens: 1024,
        });

        const content =
          response.choices[0]?.message?.content || "No response generated";
        setSolutions((prev) => ({
          ...prev,
          [solutionKey]: content,
        }));
        return content;
      }
    } catch (error) {
      addLog(`Error in getAISolution: ${error.message}`);
      throw new Error(`Failed to get AI solution: ${error.message}`);
    }
  };
  // Target audience mapping
  const getTargetAudience = (issue) => {
    const audienceMap = {
      "color-contrast": ["Visual impairments", "Low vision", "Color blindness"],
      "image-alt": [
        "Blind users",
        "Screen reader users",
        "Low bandwidth users",
      ],
      label: [
        "Screen reader users",
        "Keyboard users",
        "Cognitive disabilities",
      ],
      "heading-order": [
        "Screen reader users",
        "Cognitive disabilities",
        "Navigation difficulties",
      ],
      "link-name": [
        "Screen reader users",
        "Cognitive disabilities",
        "Motor disabilities",
      ],
      "button-name": [
        "Screen reader users",
        "Voice control users",
        "Cognitive disabilities",
      ],
      "aria-required-attr": [
        "Screen reader users",
        "Assistive technology users",
      ],
      "keyboard-navigation": [
        "Motor disabilities",
        "Keyboard-only users",
        "Screen reader users",
      ],
      "focus-management": [
        "Keyboard users",
        "Motor disabilities",
        "Cognitive disabilities",
      ],
      "landmark-roles": [
        "Screen reader users",
        "Navigation difficulties",
        "Cognitive disabilities",
      ],
      "document-title": [
        "Screen reader users",
        "Search engine users",
        "Cognitive disabilities",
      ],
      "html-has-lang": ["Screen reader users", "Translation software users"],
      bypass: ["Keyboard users", "Screen reader users", "Motor disabilities"],
      "page-has-heading-one": [
        "Screen reader users",
        "SEO",
        "Cognitive disabilities",
      ],
      list: ["Screen reader users", "Cognitive disabilities"],
      "definition-list": ["Screen reader users", "Cognitive disabilities"],
      dlitem: ["Screen reader users", "Cognitive disabilities"],
      listitem: ["Screen reader users", "Cognitive disabilities"],
      "meta-refresh": [
        "Cognitive disabilities",
        "Motor disabilities",
        "Seizure disorders",
      ],
      "meta-viewport": ["Mobile users", "Zoom users", "Low vision users"],
      region: ["Screen reader users", "Keyboard navigation users"],
      "skip-link": ["Keyboard users", "Screen reader users"],
      tabindex: ["Keyboard users", "Screen reader users"],
      "valid-lang": ["Screen reader users", "Translation software users"],
    };

    return audienceMap[issue];
  };

  // Perform accessibility test using axe-core and backend Pa11y
  const performAccessibilityTest = async (testUrl) => {
    setIsLoading(true);
    setError("");
    setResults(null);

    try {
      const response = await fetch("http://localhost:5000/api/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: testUrl }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      // Format the combined results for the frontend
      const formattedResults = {
        violations: [
          ...data.axe.violations,
          ...data.pa11y.issues.map((issue) => ({
            id: issue.code,
            description: issue.message,
            impact:
              issue.type === "error"
                ? "critical"
                : issue.type === "warning"
                ? "serious"
                : "moderate",
            nodes: [
              {
                target: issue.selector,
                html: issue.context,
              },
            ],
          })),
        ],
        passes: [...data.axe.passes, ...(data.pa11y.passes || [])],
        summary: data.summary,
      };

      return formattedResults;
    } catch (err) {
      console.error("Testing error:", err);
      throw new Error(`Accessibility testing failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGetSolution = async (violation, nodeIndex) => {
    const solutionKey = `${violation.id}-${nodeIndex}`;

    if (solutions[solutionKey]) return;

    setLoadingSolutions((prev) => ({ ...prev, [solutionKey]: true }));

    try {
      const solution = await getAISolution(
        violation.id,
        violation.description,
        violation.nodes?.[nodeIndex]?.html || violation.context
      );

      setSolutions((prev) => ({
        ...prev,
        [solutionKey]: solution,
      }));
    } catch (error) {
      setSolutions((prev) => ({
        ...prev,
        [solutionKey]: `Error getting solution: ${error.message}`,
      }));
    } finally {
      setLoadingSolutions((prev) => ({ ...prev, [solutionKey]: false }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url) return;

    try {
      const testResults = await performAccessibilityTest(url);
      setResults(testResults);
    } catch (err) {
      setError(
        "Failed to test the website. Please check the URL and try again."
      );
    }
  };

  const getSeverityIcon = (impact) => {
    switch (impact) {
      case "critical":
        return <AlertTriangle className="w-5 h-5 text-red-600" />;
      case "serious":
        return <AlertTriangle className="w-5 h-5 text-orange-600" />;
      case "moderate":
        return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      default:
        return <AlertTriangle className="w-5 h-5 text-blue-600" />;
    }
  };

  const getSeverityColor = (impact) => {
    switch (impact) {
      case "critical":
        return "border-red-500 bg-red-50";
      case "serious":
        return "border-orange-500 bg-orange-50";
      case "moderate":
        return "border-yellow-500 bg-yellow-50";
      default:
        return "border-blue-500 bg-blue-50";
    }
  };

  const getAudienceIcon = (audience) => {
    if (audience.includes("Visual") || audience.includes("Blind"))
      return <Eye className="w-4 h-4" />;
    if (audience.includes("Screen reader")) return <Ear className="w-4 h-4" />;
    if (audience.includes("Motor") || audience.includes("Keyboard"))
      return <Hand className="w-4 h-4" />;
    if (audience.includes("Cognitive")) return <Brain className="w-4 h-4" />;
    return <Bug className="w-4 h-4" />;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 w-full">
      <div className="mx-auto px-20">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Accessibility Testing Tool
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Test any website for accessibility issues and get detailed solutions
            to improve user experience for everyone.
          </p>
        </div>

        {/* URL Input Form */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <form onSubmit={handleSubmit} className="flex gap-4">
            <div className="flex-1">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Enter website URL (e.g., https://example.com)"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Testing...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Test Accessibility
                </>
              )}
            </button>
          </form>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <h3 className="font-medium text-red-900">Error</h3>
            </div>
            <p className="text-red-800 mt-2">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 mb-8">
            <div className="flex items-center justify-center gap-3">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-blue-800 font-medium">
                Testing website accessibility...
              </p>
            </div>
          </div>
        )}

        {/* Results Display */}
        {results && (
          <div className="space-y-6 ">
            {/* Summary */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Test Results
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-red-50 rounded-lg">
                  <div className="text-2xl font-bold text-red-600">
                    {results.summary?.critical || 0}
                  </div>
                  <div className="text-sm text-red-800">Critical</div>
                </div>
                <div className="text-center p-4 bg-orange-50 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">
                    {results.summary?.serious || 0}
                  </div>
                  <div className="text-sm text-orange-800">Serious</div>
                </div>
                <div className="text-center p-4 bg-yellow-50 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600">
                    {results.summary?.moderate || 0}
                  </div>
                  <div className="text-sm text-yellow-800">Moderate</div>
                </div>
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {results.summary?.minor || 0}
                  </div>
                  <div className="text-sm text-blue-800">Minor</div>
                </div>
              </div>
            </div>

            {/* Violations */}
            <div className="flex flex-row">
              {results.violations && results.violations.length > 0 && (
                <div className="bg-white rounded-lg shadow-md p-6 w-1/2 ">
                  <h3 className="text-xl font-bold text-gray-900 mb-4">
                    Accessibility Issues
                  </h3>
                  <div className="space-y-6">
                    {results.violations.map((violation, index) => (
                      <div
                        key={index}
                        className={`border-l-4 p-4 rounded-lg ${getSeverityColor(
                          violation.impact
                        )}`}
                      >
                        <div className="flex items-start gap-3 mb-3">
                          {getSeverityIcon(violation.impact)}
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-900 text-lg">
                              {violation.description}
                            </h4>
                            <p className="text-sm text-gray-600 mt-1">
                              Rule: {violation.id}
                            </p>
                            <span
                              className={`inline-block px-2 py-1 text-xs font-medium rounded-full mt-2 ${
                                violation.impact === "critical"
                                  ? "bg-red-100 text-red-800"
                                  : violation.impact === "serious"
                                  ? "bg-orange-100 text-orange-800"
                                  : violation.impact === "moderate"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-blue-100 text-blue-800"
                              }`}
                            >
                              {violation.impact?.toUpperCase()}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-4">
                          {(violation.nodes || [violation]).map(
                            (node, nodeIndex) => {
                              const solutionKey = `${violation.id}-${nodeIndex}`;
                              const targetAudience = getTargetAudience(
                                violation.id
                              );
                              const nodeHtml = node.html || node.context;
                              const nodeTarget = node.target || node.selector;

                              return (
                                <div
                                  key={nodeIndex}
                                  className="bg-gray-50 p-4 rounded-lg"
                                >
                                  <div className="flex items-start justify-between mb-3">
                                    <div>
                                      {nodeTarget && (
                                        <p className="text-sm font-medium text-gray-700 mb-1">
                                          Target:{" "}
                                          <code className="bg-gray-200 px-2 py-1 rounded text-xs">
                                            {nodeTarget}
                                          </code>
                                        </p>
                                      )}
                                      {nodeHtml && (
                                        <pre className="text-xs text-gray-600 bg-white p-2 rounded border overflow-x-auto break-words whitespace-pre-wrap ">
                                          {nodeHtml}
                                        </pre>
                                      )}
                                    </div>
                                  </div>

                                  {/* Affected Audiences */}
                                  {targetAudience && (
                                    <div className="mb-3">
                                      <h5 className="text-sm font-medium text-gray-700 mb-2">
                                        Affected Users:
                                      </h5>
                                      <div className="flex flex-wrap gap-2">
                                        {targetAudience.map((audience, idx) => (
                                          <span
                                            key={idx}
                                            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
                                          >
                                            {getAudienceIcon(audience)}
                                            {audience}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* AI Solution */}
                                  <div className="mt-3">
                                    {!solutions[solutionKey] ? (
                                      <button
                                        onClick={() =>
                                          handleGetSolution(
                                            violation,
                                            nodeIndex
                                          )
                                        }
                                        disabled={loadingSolutions[solutionKey]}
                                        className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                                      >
                                        {loadingSolutions[solutionKey]
                                          ? "Getting Solution..."
                                          : "Get AI Solution"}
                                      </button>
                                    ) : (
                                      <div className="bg-blue-50 border border-blue-200 p-3 rounded">
                                        <h5 className="text-sm font-medium text-blue-900 mb-1">
                                          AI Solution:
                                        </h5>
                                        <p className="text-sm text-blue-800 whitespace-pre-wrap">
                                          {solutions[solutionKey]}
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            }
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="w-1/2">
                {/* Passed Tests */}
                {results.passes && results.passes.length > 0 && (
                  <div className="bg-white rounded-lg shadow-md p-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-4">
                      Passed Tests
                    </h3>
                    <div className="space-y-3">
                      {results.passes.map((pass, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-3 p-3 bg-green-50 rounded-lg"
                        >
                          <CheckCircle className="w-5 h-5 text-green-600" />
                          <div>
                            <p className="font-medium text-green-900">
                              {pass.description}
                            </p>
                            <p className="text-sm text-green-700">
                              Rule: {pass.id}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccessibilityTestingApp;
