import { create } from './create';
declare global {
    interface Window {
        AIChat: {
            create: typeof create;
        };
    }
}
