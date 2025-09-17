import { render, screen } from "@testing-library/react";
import { ErrorBoundary, meta, links } from "./root";

describe("root.tsx (smoke)", () => {
    it("meta() returns a title descriptor", () => {
        // Minimal MetaArgs for react-router
        const args = {
            data: undefined,
            params: {},
            location: { pathname: "/", search: "", hash: "", state: null, key: "test" },
            matches: [],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        const m = meta(args) ?? [];
        expect(Array.isArray(m)).toBe(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(m.some((d: any) => d.title === "Image Web Converter")).toBe(true);
    });

    it("links() includes preconnect and stylesheet entries", () => {
        const l = links() ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(l.some((x: any) => x.rel === "preconnect" && /fonts\.googleapis\.com/.test(x.href))).toBe(
            true
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(l.some((x: any) => x.rel === "stylesheet" && /fonts\.googleapis\.com/.test(x.href))).toBe(
            true
        );
    });

    it("ErrorBoundary renders generic Error details", () => {
        render(
            // Passing only fields the component uses:
            <ErrorBoundary error={new Error("boom")} resetErrorBoundary={() => {
                //
            }} />
        );
        expect(screen.getByText("Error")).toBeInTheDocument();
        expect(screen.getByText("boom")).toBeInTheDocument();
    });
});
