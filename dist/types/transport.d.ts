import type { Endpoints, Transport } from './types';
export declare const DEFAULT_ENDPOINTS: Endpoints;
export declare function makeDefaultTransport(endpoints: Endpoints, guard: {
    name: string;
    value: string;
}): Transport;
