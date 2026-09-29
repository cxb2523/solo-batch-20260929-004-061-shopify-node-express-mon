import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Layout,
  Link,
  Page,
  Text,
} from "@shopify/polaris";
import { navigate } from "raviger";
import { useEffect, useState } from "react";
import oauthChain from "../../../shared/oauthChain.js";

const phaseTone = {
  redirect: "info",
  callback: "primary",
  storage: "success",
  read: "attention",
  cleanup: "warning",
};

const branchTone = {
  success: "success",
  failure: "critical",
};

const CodePill = ({ children }) => (
  <Text as="span" variant="bodySm" tone="subdued">
    <code>{children}</code>
  </Text>
);

const StepCard = ({ step }) => (
  <Layout.Section>
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" gap="200">
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Badge size="large">{step.order}</Badge>
            <Text as="h2" variant="headingSm">
              {step.title}
            </Text>
          </InlineStack>
          <Badge tone={phaseTone[step.phase] || "base"}>{step.phase}</Badge>
        </InlineStack>

        <Text as="p" variant="bodyMd" tone="subdued">
          {step.description}
        </Text>

        <InlineStack gap="400" wrap={false}>
          <CodePill>
            {step.method} {step.route}
          </CodePill>
          <CodePill>{step.file}</CodePill>
          <CodePill>{step.function}()</CodePill>
        </InlineStack>
      </BlockStack>
    </Card>
  </Layout.Section>
);

const SectionCard = ({ title, children }) => (
  <Layout.Section>
    <Card>
      <BlockStack gap="200">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>
        {children}
      </BlockStack>
    </Card>
  </Layout.Section>
);

/**
 * Debug page that renders the OAuth install chain as clickable steps.
 *
 * The steps, state/nonce branches and tradeoffs come from the shared
 * `shared/oauthChain.js` module (also served by `GET /debug/oauth`). The
 * "Re-sync endpoint" button fetches that endpoint and flags whether the live
 * JSON matches the module the page renders, proving there is a single source.
 */
const OAuthChain = () => {
  const [liveChain, setLiveChain] = useState(null);
  const [inSync, setInSync] = useState(null);

  const syncEndpoint = async () => {
    const response = await fetch("/debug/oauth");
    const live = await response.json();
    setLiveChain(live);
    setInSync(JSON.stringify(live.steps) === JSON.stringify(oauthChain.steps));
  };

  useEffect(() => {
    syncEndpoint();
  }, []);

  return (
    <Page
      title="OAuth Install Chain"
      subtitle="/auth → /auth/callback → session persistence"
      backAction={{ content: "Debug", onAction: () => navigate("/debug") }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <InlineStack align="space-between" blockAlign="center" gap="200">
              <BlockStack gap="100">
                <Text as="h2" variant="headingSm">
                  Single source of truth
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Rendered from <CodePill>shared/oauthChain.js</CodePill>, the
                  same module served by{" "}
                  <Link url="/debug/oauth" external>
                    GET /debug/oauth
                  </Link>
                  .
                </Text>
              </BlockStack>
              <InlineStack gap="200" blockAlign="center">
                {inSync !== null && (
                  <Badge tone={inSync ? "success" : "critical"}>
                    {inSync ? "endpoint in sync" : "drift detected"}
                  </Badge>
                )}
                <Button variant="primary" onClick={syncEndpoint}>
                  Re-sync endpoint
                </Button>
              </InlineStack>
            </InlineStack>
          </Card>
        </Layout.Section>

        {oauthChain.steps.map((step) => (
          <StepCard key={step.id} step={step} />
        ))}

        <SectionCard title="state / nonce validation branches">
          <InlineGrid columns={{ xs: "1fr", sm: "1fr 1fr" }} gap="200">
            {oauthChain.stateNonceBranches.map((branch) => (
              <BlockStack key={branch.id} gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <CodePill>{branch.id}</CodePill>
                  <Badge tone={branchTone[branch.result]}>
                    {branch.result}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm">
                  {branch.check}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {branch.behavior}
                </Text>
              </BlockStack>
            ))}
          </InlineGrid>
        </SectionCard>

        <SectionCard title="Tradeoffs written into the code">
          <BlockStack gap="200">
            {oauthChain.tradeoffs.map((tradeoff) => (
              <BlockStack key={tradeoff.id} gap="100">
                <CodePill>{tradeoff.title}</CodePill>
                <Text as="p" variant="bodySm">
                  {tradeoff.detail}
                </Text>
              </BlockStack>
            ))}
          </BlockStack>
        </SectionCard>

        <SectionCard title="Doc / code differences (code wins)">
          <BlockStack gap="200">
            {oauthChain.docCodeDiffs.map((diff) => (
              <BlockStack key={diff.topic} gap="100">
                <Text as="h3" variant="headingSm">
                  {diff.topic}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Doc: {diff.doc}
                </Text>
                <Text as="p" variant="bodySm">
                  Code: {diff.code}
                </Text>
              </BlockStack>
            ))}
          </BlockStack>
        </SectionCard>

        {liveChain && (
          <SectionCard title="Raw endpoint JSON">
            <CodePill>
              <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {JSON.stringify(liveChain, null, 2)}
              </pre>
            </CodePill>
          </SectionCard>
        )}
      </Layout>
    </Page>
  );
};

export default OAuthChain;
