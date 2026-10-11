import { describe, it, expect } from "vitest";
import { generateAllFiles } from "../../src/generator/file-generator.js";

/**
 * Regression: `docker-container.homepage: false` must suppress EVERY Homepage
 * artifact, not just the compose labels.
 *
 * The Homepage integration injects `homepage.*` container labels (the label
 * discovery path). On an estate where every other service is a manual
 * services.yaml entry, that is actively unhelpful: Homepage prepends
 * label-discovered services and cannot sort them alphabetically, so the
 * generated service renders icon-less and out of order.
 *
 * `homepage: false` is the opt-out. It already dropped the labels; it must also
 * drop the generated `deploy/homepage-services.yaml` snippet, so opting out
 * emits no Homepage artifact at all and the reader defines their entry by hand.
 */

const DC = {
  healthcheck: "http:/healthz",
  exposePort: 3001,
  publishPort: "127.0.0.1:3001:3001",
};

async function generate(dc) {
  const files = await generateAllFiles({
    projectName: "optout-probe",
    description: "probe",
    capabilities: ["devcontainer-python", "docker-container"],
    configuration: { "docker-container": dc },
    registryNamespace: "nickbrett1",
  });
  const get = (p) => files.find((f) => f.filePath === p);
  return { files, get };
}

describe("docker-container homepage opt-out", () => {
  it("emits labels and the snippet by default", async () => {
    const { get } = await generate(DC);
    expect(get("docker-compose.yml").content).toContain("homepage.group=");
    expect(get("docker-compose.yml").content).toContain("homepage.widget.url=");
    expect(get("deploy/homepage-services.yaml")).toBeDefined();
  });

  it("emits labels and the snippet when homepage: true", async () => {
    const { get } = await generate({ ...DC, homepage: true });
    expect(get("docker-compose.yml").content).toContain("homepage.group=");
    expect(get("deploy/homepage-services.yaml")).toBeDefined();
  });

  it("suppresses EVERY Homepage artifact when homepage: false", async () => {
    const { get } = await generate({ ...DC, homepage: false });

    // No labels (the label-discovery path is what renders icon-less / unsorted).
    const compose = get("docker-compose.yml").content;
    expect(compose).not.toContain("homepage.");

    // No snippet either: opting out emits no Homepage artifact at all.
    expect(get("deploy/homepage-services.yaml")).toBeUndefined();

    // ...and the still-present deploy README must not point at the absent file;
    // it states the opt-out instead.
    const readme = get("deploy/README.md").content;
    expect(readme).not.toContain("Append `deploy/homepage-services.yaml`");
    expect(readme).toContain("homepage: false");
  });

  it("still emits the non-Homepage compose labels when opted out", async () => {
    const { get } = await generate({ ...DC, homepage: false });
    // Only the homepage.* labels are suppressed; watchtower stays.
    expect(get("docker-compose.yml").content).toContain(
      "com.centurylinklabs.watchtower.enable=true",
    );
  });
});
