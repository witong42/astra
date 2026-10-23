import { expect, test } from "bun:test";
import { Renderer } from "@openuidev/react-lang";
import { renderToStaticMarkup } from "react-dom/server";
import { openuiCatalog } from "../src/openui";
import { openuiLibrary } from "../src/openui-components";

test("the host renderer shares the validated catalog and escapes generated strings", () => {
  expect(openuiLibrary.toJSONSchema()).toEqual(openuiCatalog.toJSONSchema());
  const html = renderToStaticMarkup(
    <Renderer
      library={openuiLibrary}
      response={
        'root = Stack([Heading("Hybrid lab"), Text("<script>alert(1)</script>"), Metric("Speed", 2), Table(["Name", "Value"], [["Orbit", 2]])])'
      }
      publishObservability={false}
    />,
  );
  expect(html).toContain("Hybrid lab");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("Orbit");
});
