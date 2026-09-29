import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Collapsible,
  InlineGrid,
  InlineStack,
  Layout,
  Link,
  Page,
  Text,
} from "@shopify/polaris";
import { navigate } from "raviger";
import { useCallback, useEffect, useState } from "react";
import sharedOAuthChain from "../../../shared/oauthChain.js";

const kindTone = {
  state: "attention",
  nonce: "warning",
  hmac: "warning",
  bot: "critical",
  success: "success",
};

/**
 * Renders one install-chain step as an expandable, clickable card that names
 * its source file and implementing function.
 *
 * @param {Object} props - Component props.
 * @param {number} props.index - Zero-based step position.
 * @param {import("../../../shared/oauthChain.js").OAuthChainEntry} props.step -
 *   Chain step descriptor from the shared data source.
 * @returns {JSX.Element} The rendered step.
 */
const OAuthStep = ({ index, step }) => {
  const [open, setOpen] = useState(index === 0);

  const label = step.method
    ? `${step.method} ${step.path}`
    : step.library
      ? "Library internal"
      : "Code step";

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Badge tone="info">{index + 1}</Badge>
              <Text as="h3" variant="headingSm" fontWeight="semibold">
                {step.title}
              </Text>
              <Badge tone={step.library ? "magic" : "success"}>{label}</Badge>
            </InlineStack>
            <InlineStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                {step.file}
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {step.fn}()
              </Text>
            </InlineStack>
          </BlockStack>
          <Button
            plain
            accessibilityLabel={`Toggle details for ${step.title}`}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide" : "Details"}
          </Button>
        </InlineStack>
        <Collapsible open={open} id={`oauth-step-${step.id}`}>
          <Text as="p" variant="bodySm">
            {step.detail}
          </Text>
        </Collapsible>
      </BlockStack>
    </Card>
  );
};

/**
 * Debug page visualizing the OAuth install chain. Steps are rendered from the
 * live `GET /debug/oauth` response, which serves the same
 * `shared/oauthChain.js` module this page imports directly; a mismatch is
 * surfaced instead of silently drifting.
 *
 * @returns {JSX.Element} The rendered page.
 */
const OAuthChainPage = () => {
  const [chain, setChain] = useState(sharedOAuthChain);
  const [inSync, setInSync] = useState(true);
  const [loading, setLoading] = useState(false);

  const fetchChain = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(sharedOAuthChain.endpoint);
      const data = await response.json();
      setInSync(
        JSON.stringify(data.steps) === JSON.stringify(sharedOAuthChain.steps)
      );
      setChain(data);
    } catch (error) {
      // Offline / no-session preview: keep rendering the bundled copy.
      setChain(sharedOAuthChain);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChain();
  }, [fetchChain]);

  return (
    <Page
      title="OAuth Install Chain"
      subtitle="Every step of /auth and /auth/callback, with source file and function"
      backAction={{ content: "Debug", onAction: () => navigate("/debug") }}
      primaryAction={
        <Button
          url={sharedOAuthChain.endpoint}
          external
          loading={loading}
          onClick={fetchChain}
        >
          Open GET /debug/oauth
        </Button>
      }
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="300">
            <Card>
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingSm">
                  Data source
                </Text>
                <Badge tone={inSync ? "success" : "critical"}>
                  {inSync
                    ? "API and page share shared/oauthChain.js"
                    : "API response differs from bundled chain"}
                </Badge>
              </InlineStack>
            </Card>

            {chain.steps.map((step, index) => (
              <OAuthStep key={step.id} index={index} step={step} />
            ))}
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="300">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingSm">
                  State / Nonce branches
                </Text>
                {chain.branches.map((branch) => (
                  <BlockStack gap="100" key={branch.id}>
                    <InlineStack gap="100" blockAlign="center">
                      <Badge tone={kindTone[branch.kind] || "info"}>
                        {branch.kind}
                      </Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {branch.condition}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {branch.outcome}
                    </Text>
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingSm">
                  Mongo indexes
                </Text>
                {chain.indexes.map((indexEntry) => (
                  <BlockStack gap="100" key={indexEntry.key}>
                    <InlineGrid columns="1fr">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {indexEntry.key}
                      </Text>
                    </InlineGrid>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {indexEntry.purpose}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {indexEntry.file}
                    </Text>
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="100">
                <Text as="h2" variant="headingSm">
                  Shared TTL
                </Text>
                <Badge tone="info">{chain.ttl.ttl}</Badge>
                <Text as="p" variant="bodySm" tone="subdued">
                  {chain.ttl.detail}
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="100">
                <Text as="h2" variant="headingSm">
                  Raw JSON
                </Text>
                <Link url={sharedOAuthChain.endpoint} external monochrome>
                  {sharedOAuthChain.endpoint}
                </Link>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
};

export default OAuthChainPage;
