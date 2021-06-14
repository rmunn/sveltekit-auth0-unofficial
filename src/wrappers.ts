import url from 'url';
import type { Request, EndpointOutput } from '@sveltejs/kit';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { ReadOnlyFormData, Headers } from '@sveltejs/kit/types/helper';

function ensureLeadingSlash(path: string) {
    return path.startsWith('/') ? path : `/${path}`;
}

function buildUrl(host: any, path: any, query: URLSearchParams) {
    const slashPath = ensureLeadingSlash(path || '/');
    const urlObj = new url.URL(`https://${host}${slashPath}`);
    if (typeof query === "string") {
        urlObj.search = query;
    } else if (query && typeof query.toString === "function") {
        urlObj.search = query.toString();
    }
    return urlObj.toString();
}

// TODO: Implement caching with WeakMap so that auth0's session cache can be used to best effect, as otherwise we'll be calling this too often
// Cache should, given the same Svelte request object, always return the same NextApiRequest mimic
function mkReq(param: Request) : NextApiRequest {
    const result : any = {
        method: 'GET',
        headers: (param.headers ? param.headers : param) as Headers,
        query: Object.fromEntries(param.query as any),  // TODO: Check whether just plain `param.query` will work here
        url: buildUrl(param.host || 'localhost', param.path || '/', param.query),
        // TODO: Build "cookies" object since Auth0 will want it
    };
    if (param.body && typeof (param.body as ReadOnlyFormData).getAll === "function") {
        // Body is a ReadOnlyFormData object from Svelte, but auth0-nextjs will expect a plain object
        result.body = Object.fromEntries(param.body as any);
    } else if (typeof param.body === "string") {
        result.body = param.body;
    } else {
        result.body = param.body || {};
    }
    return result;
}

// TODO: Implement caching with WeakMap based on original Svelte request object (which we'll preserve a reference to in the ResMimic instance so that they're deferenced together)
class ResMimic {
    headers: Map<any, any>;
    statusCode: number;
    statusMessage: string | undefined;
    bodyObj: { [key: string]: any };
    bodyStr: string;

    constructor() {
        this.headers = new Map();
        this.statusCode = 200;
        this.bodyObj = undefined;
        this.bodyStr = "";
    }

    getHeader(key: any) {
        const value = this.headers.get(key);
        if (value && value.length === 1) {
            return value[0];
        } else {
            return value;
        }
    }

    setHeader(key: string, value: any) {
        const oldValue = this.headers.get(key.toLowerCase()) || [];
        const newValue = typeof value === 'string' ? [...oldValue, value] : [...oldValue, ...value];
        this.headers.set(key.toLowerCase(), newValue);
        return this;
    }

    writeHead(status: number, reason?: any, headers?: any) {
        this.statusCode = status;
        let realHeaders;
        if (typeof reason === 'string') {
            this.statusMessage = reason;
            realHeaders = headers;
        } else if (typeof reason === 'object' && !headers) {
            realHeaders = reason;
        } else {
            realHeaders = headers || {};
        }
        for (const key in realHeaders) {
            if (Object.prototype.hasOwnProperty.call(realHeaders, key)) {
                this.setHeader(key, realHeaders[key]);
            }
        }
        return this;
    }

    end() {
        return this;
    }

    send(body: { [key: string]: any } | string) {
        if (typeof body === "object") {
            this.bodyObj = body;
        } else {
            this.bodyStr = body;
        }
        return this;
    }

    status(statusCode: any) {
        this.statusCode = statusCode;
        return this;
    }

    json(bodyObj: any) {
        this.bodyObj = bodyObj;
        this.setHeader('content-type', 'application/json');
        return this;
    }

    getSvelteResponse() : EndpointOutput {
        const status = this.statusCode;
        const headers = {};
        for (const [k, v] of this.headers.entries()) {
            headers[k] = (v.length === 1 ? v[0] : v);
        }
        const body = this.bodyObj ? this.bodyObj : this.bodyStr;
        return { status, headers, body };
    }
}

function auth0Wrapper(auth0fn: (req: NextApiRequest, res: NextApiResponse, arg2?: any) => Promise<any>) {
    return (param: any, auth0FnOptions: any) => {
        const req = mkReq(param);
        const res = new ResMimic();
        return auth0fn(req, (res as unknown) as NextApiResponse, auth0FnOptions).then(() => { return res.getSvelteResponse(); }).catch((error: any) => ({ status: 500, body: error }));
    };
}

function auth0WrapperJson(auth0fn: (req: NextApiRequest, res: NextApiResponse, arg2?: any) => any) {
    return (svelteReq: Request, auth0FnOptions?: any) => {
        const req = mkReq(svelteReq);
        const res = new ResMimic();
        return auth0fn(req, (res as unknown) as NextApiResponse, auth0FnOptions);
    };
}

export { mkReq, ResMimic, auth0Wrapper, auth0WrapperJson }
