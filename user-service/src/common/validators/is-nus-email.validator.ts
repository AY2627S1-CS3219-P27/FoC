import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * NUS domains accepted as registration emails. Kept exact: an
 * email "terminates with" `@u.nus.edu` or `@nus.edu.sg`, so subdomains such
 * as `@comp.nus.edu.sg` are not accepted.
 */
const NUS_EMAIL_DOMAINS: readonly string[] = ['u.nus.edu', 'nus.edu.sg'];

@ValidatorConstraint({ name: 'isNusEmail', async: false })
export class IsNusEmailConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }

    // Compare everything in lowercase so the rule is case-insensitive no
    // matter whether the caller normalizes.
    const email = value.toLowerCase();

    // Compare against the domain after the LAST '@'
    const at = email.lastIndexOf('@');
    if (at <= 0 || at === email.length - 1) {
      return false;
    }

    return NUS_EMAIL_DOMAINS.includes(email.slice(at + 1));
  }

  defaultMessage(): string {
    return 'email must be an NUS email ending in @u.nus.edu or @nus.edu.sg';
  }
}

export function IsNusEmail(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsNusEmailConstraint,
    });
  };
}
