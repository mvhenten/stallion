import type { ErrorObject } from "ajv";
import type { StallionObject } from "../src/model";

type Validate = ((data: unknown) => data is StallionObject) & { errors?: ErrorObject[] | null };

export declare const validate: Validate;
export default validate;
