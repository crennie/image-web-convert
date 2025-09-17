import { render, screen } from "@testing-library/react";
import { userEvent } from '@testing-library/user-event';
import { ConversionErrorBoundary } from "../components/ConversionErrorBoundary";

describe("ConversionErrorBoundary", () => {
    it("shows the error message and a Try again button", () => {
        render(
            <ConversionErrorBoundary
                error={{ message: "Boom!" }}
                resetErrorBoundary={() => {
                    // pass
                }}
            />
        );
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
        expect(screen.getByText("Boom!")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });

    it("calls resetErrorBoundary when Try again is clicked", async () => {
        const reset = vi.fn();
        render(
            <ConversionErrorBoundary
                error={{ message: "Oops" }}
                resetErrorBoundary={reset}
            />
        );
        await userEvent.click(screen.getByRole("button", { name: /try again/i }));
        expect(reset).toHaveBeenCalledTimes(1);
    });
});
