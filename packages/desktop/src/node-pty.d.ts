declare module "node-pty" {
  export interface IPty {
    [key: string]: unknown;
  }
  export interface IPtyForkOptions {
    [key: string]: unknown;
  }
  export interface IWindowsPtyForkOptions extends IPtyForkOptions {
    [key: string]: unknown;
  }
  export function spawn(...args: unknown[]): IPty;
}
